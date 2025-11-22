package main

import (
	"log"
	"os"

	"github.com/joho/godotenv"
	"imgvault/internal/api"
	"imgvault/internal/database"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	// Initialize database
	db, err := database.InitDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	// Run migrations
	if err := database.RunMigrations(db); err != nil {
		log.Fatal("Failed to run migrations:", err)
	}

	// Get server port
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Start API server
	log.Printf("Starting ImgVault API server on port %s...", port)
	if err := api.StartServer(db, port); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
