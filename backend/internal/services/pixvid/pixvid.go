package pixvid

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
)

// PixvidResponse represents the response from Pixvid API (Chevereto)
type PixvidResponse struct {
	StatusCode int `json:"status_code"`
	Success    struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	} `json:"success"`
	Image struct {
		Name          string `json:"name"`
		Extension     string `json:"extension"`
		Size          int64  `json:"size"`
		Width         int    `json:"width"`
		Height        int    `json:"height"`
		Date          string `json:"date"`
		DateGMT       string `json:"date_gmt"`
		Title         string `json:"title"`
		URL           string `json:"url"`
		URLViewer     string `json:"url_viewer"`
		Thumb         string `json:"thumb"`
		Medium        string `json:"medium"`
		DisplayURL    string `json:"display_url"`
		DisplayWidth  int    `json:"display_width"`
		DisplayHeight int    `json:"display_height"`
	} `json:"image"`
}

// UploadToPixvid uploads a file to Pixvid.org and returns the URL
func UploadToPixvid(file io.Reader, filename string) (string, error) {
	// Create a buffer to write our multipart form
	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)

	// Create form file with field name "source" (as per Chevereto API)
	part, err := writer.CreateFormFile("source", filename)
	if err != nil {
		return "", fmt.Errorf("error creating form file: %w", err)
	}

	// Copy the file to the form
	if _, err := io.Copy(part, file); err != nil {
		return "", fmt.Errorf("error copying file: %w", err)
	}

	// Close the writer
	writer.Close()

	// Create the request
	apiURL := "https://pixvid.org/api/1/upload"
	req, err := http.NewRequest("POST", apiURL, &requestBody)
	if err != nil {
		return "", fmt.Errorf("error creating request: %w", err)
	}

	// Set headers
	req.Header.Set("Content-Type", writer.FormDataContentType())
	
	// Add API key (required for Pixvid)
	apiKey := os.Getenv("PIXVID_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("PIXVID_API_KEY is required in .env file")
	}
	req.Header.Set("X-API-Key", apiKey)

	// Send the request
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("error sending request: %w", err)
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error reading response: %w", err)
	}

	// Check status code
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("pixvid API error (status %d): %s", resp.StatusCode, string(body))
	}

	// Parse response
	var result PixvidResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("error parsing response: %w", err)
	}

	// Check if upload was successful
	if result.StatusCode != 200 {
		return "", fmt.Errorf("pixvid upload failed with status code: %d", result.StatusCode)
	}

	// Return the image URL
	if result.Image.URL != "" {
		return result.Image.URL, nil
	}

	return "", fmt.Errorf("no URL in response")
}
