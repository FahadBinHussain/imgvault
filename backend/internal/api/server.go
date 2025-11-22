package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	"github.com/lib/pq"
	"github.com/rs/cors"
	"imgvault/internal/models"
	"imgvault/internal/services/pixvid"
)

type Server struct {
	db     *sql.DB
	router *mux.Router
}

// StartServer starts the HTTP server
func StartServer(db *sql.DB, port string) error {
	s := &Server{
		db:     db,
		router: mux.NewRouter(),
	}

	// Setup routes
	s.setupRoutes()

	// Setup CORS
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
	})

	handler := c.Handler(s.router)

	// Start server
	addr := fmt.Sprintf(":%s", port)
	log.Printf("Server listening on %s", addr)
	return http.ListenAndServe(addr, handler)
}

// setupRoutes sets up all API routes
func (s *Server) setupRoutes() {
	api := s.router.PathPrefix("/api").Subrouter()

	api.HandleFunc("/upload", s.handleUpload).Methods("POST", "OPTIONS")
	api.HandleFunc("/images", s.handleGetImages).Methods("GET")
	api.HandleFunc("/images/{id}", s.handleGetImage).Methods("GET")
	api.HandleFunc("/images/{id}", s.handleDeleteImage).Methods("DELETE")
	api.HandleFunc("/health", s.handleHealth).Methods("GET")
}

// handleUpload handles image upload requests
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	// Parse multipart form (max 32MB)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		respondWithError(w, http.StatusBadRequest, "Failed to parse form data")
		return
	}

	// Get the file from form
	file, header, err := r.FormFile("file")
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "No file provided")
		return
	}
	defer file.Close()

	// Get form values
	sourceImageURL := r.FormValue("source_image_url")
	sourcePageURL := r.FormValue("source_page_url")
	pageTitle := r.FormValue("page_title")
	notes := r.FormValue("notes")
	tagsStr := r.FormValue("tags")

	// Parse tags
	var tags []string
	if tagsStr != "" {
		tags = strings.Split(tagsStr, ",")
		for i := range tags {
			tags[i] = strings.TrimSpace(tags[i])
		}
	}

	// Upload to Pixvid
	log.Printf("Uploading file %s to Pixvid...", header.Filename)
	storedURL, err := pixvid.UploadToPixvid(file, header.Filename)
	if err != nil {
		log.Printf("Pixvid upload error: %v", err)
		respondWithError(w, http.StatusInternalServerError, fmt.Sprintf("Failed to upload to Pixvid: %v", err))
		return
	}

	// Determine file type
	fileType := header.Header.Get("Content-Type")
	if fileType == "" {
		fileType = "application/octet-stream"
	}

	// Save to database
	var imageID string
	query := `
		INSERT INTO images (stored_url, source_image_url, source_page_url, page_title, file_type, file_size, notes, tags)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`
	err = s.db.QueryRow(
		query,
		storedURL,
		sourceImageURL,
		sourcePageURL,
		pageTitle,
		fileType,
		header.Size,
		notes,
		pq.Array(tags),
	).Scan(&imageID)

	if err != nil {
		log.Printf("Database error: %v", err)
		respondWithError(w, http.StatusInternalServerError, "Failed to save to database")
		return
	}

	// Fetch the created image
	image, err := s.getImageByID(imageID)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to retrieve saved image")
		return
	}

	respondWithJSON(w, http.StatusCreated, models.UploadResponse{
		Success: true,
		Message: "Image uploaded successfully",
		Image:   image,
	})
}

// handleGetImages returns all images
func (s *Server) handleGetImages(w http.ResponseWriter, r *http.Request) {
	query := `
		SELECT id, stored_url, source_image_url, source_page_url, page_title, 
		       file_type, file_size, notes, tags, created_at
		FROM images
		ORDER BY created_at DESC
	`

	rows, err := s.db.Query(query)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to fetch images")
		return
	}
	defer rows.Close()

	images := []models.Image{}
	for rows.Next() {
		var img models.Image
		var tags pq.StringArray
		err := rows.Scan(
			&img.ID, &img.StoredURL, &img.SourceImageURL, &img.SourcePageURL,
			&img.PageTitle, &img.FileType, &img.FileSize, &img.Notes, &tags, &img.CreatedAt,
		)
		if err != nil {
			log.Printf("Error scanning row: %v", err)
			continue
		}
		img.Tags = tags
		images = append(images, img)
	}

	respondWithJSON(w, http.StatusOK, images)
}

// handleGetImage returns a single image by ID
func (s *Server) handleGetImage(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	image, err := s.getImageByID(id)
	if err != nil {
		if err == sql.ErrNoRows {
			respondWithError(w, http.StatusNotFound, "Image not found")
		} else {
			respondWithError(w, http.StatusInternalServerError, "Failed to fetch image")
		}
		return
	}

	respondWithJSON(w, http.StatusOK, image)
}

// handleDeleteImage deletes an image
func (s *Server) handleDeleteImage(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	query := `DELETE FROM images WHERE id = $1`
	result, err := s.db.Exec(query, id)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "Failed to delete image")
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		respondWithError(w, http.StatusNotFound, "Image not found")
		return
	}

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Image deleted successfully",
	})
}

// handleHealth returns server health status
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"status": "healthy",
		"service": "ImgVault API",
	})
}

// Helper functions

func (s *Server) getImageByID(id string) (*models.Image, error) {
	query := `
		SELECT id, stored_url, source_image_url, source_page_url, page_title,
		       file_type, file_size, notes, tags, created_at
		FROM images
		WHERE id = $1
	`

	var img models.Image
	var tags pq.StringArray
	err := s.db.QueryRow(query, id).Scan(
		&img.ID, &img.StoredURL, &img.SourceImageURL, &img.SourcePageURL,
		&img.PageTitle, &img.FileType, &img.FileSize, &img.Notes, &tags, &img.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	img.Tags = tags
	return &img, nil
}

func respondWithError(w http.ResponseWriter, code int, message string) {
	respondWithJSON(w, code, map[string]string{"error": message})
}

func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	response, err := json.Marshal(payload)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"Failed to marshal response"}`))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write(response)
}
