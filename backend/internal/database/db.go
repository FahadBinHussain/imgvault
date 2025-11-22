package database

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/lib/pq"
)

// InitDB initializes the database connection
func InitDB() (*sql.DB, error) {
	var connStr string

	// Check if DATABASE_URL is set (for Neon DB or single connection string)
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		connStr = dbURL
	} else {
		// Build connection string from individual environment variables
		connStr = fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			os.Getenv("DB_HOST"),
			os.Getenv("DB_PORT"),
			os.Getenv("DB_USER"),
			os.Getenv("DB_PASSWORD"),
			os.Getenv("DB_NAME"),
			os.Getenv("DB_SSLMODE"),
		)
	}

	// Open database connection
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("error opening database: %w", err)
	}

	// Test the connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("error connecting to database: %w", err)
	}

	// Set connection pool settings
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)

	return db, nil
}

// RunMigrations creates the necessary tables if they don't exist
func RunMigrations(db *sql.DB) error {
	query := `
	CREATE TABLE IF NOT EXISTS images (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		stored_url TEXT NOT NULL,
		source_image_url TEXT,
		source_page_url TEXT,
		page_title TEXT,
		file_type TEXT,
		file_size INTEGER,
		notes TEXT,
		tags TEXT[],
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_images_tags ON images USING GIN(tags);
	`

	_, err := db.Exec(query)
	if err != nil {
		return fmt.Errorf("error running migrations: %w", err)
	}

	return nil
}
