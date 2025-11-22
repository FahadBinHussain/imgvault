package models

import "time"

// Image represents an image record in the database
type Image struct {
	ID              string    `json:"id"`
	StoredURL       string    `json:"stored_url"`
	SourceImageURL  string    `json:"source_image_url,omitempty"`
	SourcePageURL   string    `json:"source_page_url,omitempty"`
	PageTitle       string    `json:"page_title,omitempty"`
	FileType        string    `json:"file_type"`
	FileSize        int64     `json:"file_size"`
	Notes           string    `json:"notes,omitempty"`
	Tags            []string  `json:"tags,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

// UploadRequest represents the request body for uploading an image
type UploadRequest struct {
	SourceImageURL string   `json:"source_image_url"`
	SourcePageURL  string   `json:"source_page_url"`
	PageTitle      string   `json:"page_title"`
	Notes          string   `json:"notes"`
	Tags           []string `json:"tags"`
}

// UploadResponse represents the response after uploading an image
type UploadResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Image   *Image `json:"image,omitempty"`
}
