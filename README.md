# ImgVault

A browser extension with Go backend that saves images to your personal vault using Pixeldrain API and PostgreSQL.

## Features

- 🖼️ **Context Menu Integration**: Right-click any image and save to vault
- 📸 **Image Preview**: See the image before uploading
- 🔗 **URL Tracking**: Automatically captures source image URL and page URL
- ✏️ **Editable Metadata**: Edit page URLs, add notes and tags
- ☁️ **Cloud Storage**: Images uploaded to Pixeldrain
- 🗄️ **PostgreSQL Database**: All metadata stored in PostgreSQL
- 🔍 **Search & Filter**: Tag-based organization (coming soon)

## Architecture

```
ImgVault/
├── extension/          # Browser extension (Chrome/Edge/Brave)
│   ├── manifest.json
│   ├── popup.html/css/js
│   ├── background.js
│   └── content.js
└── backend/           # Go API server
    ├── cmd/server/
    ├── internal/
    │   ├── api/
    │   ├── database/
    │   ├── models/
    │   └── services/
    └── go.mod
```

## Prerequisites

- **Go** 1.21 or higher
- **PostgreSQL** 14 or higher
- **Chrome/Edge/Brave** browser (for extension)

## Setup Instructions

### 1. Database Setup

#### Option A: Using Neon DB (Recommended)

1. Sign up at [Neon.tech](https://neon.tech)
2. Create a new project
3. Copy your connection string
4. Add to `.env` file:
   ```
   DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
   ```

#### Option B: Using Local PostgreSQL

```powershell
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE imgvault;

# Connect to the database
\c imgvault

# Tables will be created automatically by the Go application
```

Then configure individual variables in `.env`:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=imgvault
DB_SSLMODE=disable
```

### 2. Backend Setup

```powershell
# Navigate to backend directory
cd backend

# Copy environment file
copy .env.example .env

# Edit .env with your database credentials
notepad .env

# Download dependencies
go mod download

# Run the server
go run cmd/server/main.go
```

The server will start on `http://localhost:8080`

### 3. Browser Extension Setup

#### Chrome/Edge/Brave

1. Open your browser and navigate to:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
   - **Brave**: `brave://extensions/`

2. Enable "Developer mode" (toggle in top-right corner)

3. Click "Load unpacked"

4. Select the `extension` folder from this project

5. The ImgVault extension should now appear in your extensions list

### 4. Usage

1. **Save an Image**:
   - Right-click on any image
   - Select "Save to ImgVault"
   - Extension popup opens with image preview

2. **Review & Edit**:
   - Preview the image
   - Edit the page URL if needed (click edit icon)
   - Add notes and tags (optional)

3. **Upload**:
   - Click "Upload to Vault"
   - Image is uploaded to Pixeldrain
   - Metadata saved to PostgreSQL

4. **View Your Images**:
   - Access via API: `GET http://localhost:8080/api/images`
   - (Web dashboard coming soon)

## API Endpoints

### Upload Image
```
POST /api/upload
Content-Type: multipart/form-data

Fields:
- file: image file
- source_image_url: original image URL
- source_page_url: page where image was found
- page_title: page title
- notes: optional notes
- tags: comma-separated tags
```

### Get All Images
```
GET /api/images
```

### Get Single Image
```
GET /api/images/{id}
```

### Delete Image
```
DELETE /api/images/{id}
```

### Health Check
```
GET /api/health
```

## Database Schema

```sql
CREATE TABLE images (
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
```

## Configuration

### Backend (.env)

**Database Options:**
- `DATABASE_URL`: Single PostgreSQL connection string (recommended for Neon DB)
  - OR use individual variables below:
- `DB_HOST`: PostgreSQL host
- `DB_PORT`: PostgreSQL port
- `DB_USER`: Database user
- `DB_PASSWORD`: Database password
- `DB_NAME`: Database name
- `DB_SSLMODE`: SSL mode (require for Neon, disable for local)

**Server:**
- `PORT`: API server port (default: 8080)

**API Keys:**
- `PIXVID_API_KEY`: **Required** Pixvid API key (get from https://pixvid.org/settings/api)

### Extension

Update `manifest.json` if you need to change the backend URL:

```json
"host_permissions": [
  "http://localhost:8080/*"
]
```

For production, change to your production API URL.

## Pixvid Integration

This project uses [Pixvid.org](https://pixvid.org) (Chevereto-based) for image hosting:

- **API Key Required**: Get your free API key from https://pixvid.org/settings/api
- Files are publicly accessible via URL
- Reliable image hosting with Chevereto platform
- Direct image URLs for easy sharing

To get started:
1. Create an account at https://pixvid.org
2. Go to Settings → API
3. Copy your API key
4. Set `PIXVID_API_KEY` in your `.env` file

## Development

### Run Backend in Development
```powershell
cd backend
go run cmd/server/main.go
```

### Build Backend for Production
```powershell
cd backend
go build -o imgvault.exe cmd/server/main.go
```

### Extension Development
- Make changes to extension files
- Click reload icon in browser extensions page
- Test immediately

## Troubleshooting

### "Failed to connect to database"
- Verify PostgreSQL is running
- Check `.env` credentials
- Ensure database exists

### "Upload failed"
- Check backend server is running on port 8080
- Verify CORS settings in `server.go`
- Check browser console for errors

### Extension not working
- Verify extension is enabled
- Check manifest.json for errors
- Look at browser extension console (background page)

## Future Enhancements

- [ ] Web dashboard for browsing saved images
- [ ] Full-text search
- [ ] Image collections/albums
- [ ] Export functionality
- [ ] Multiple cloud storage providers
- [ ] OCR for image text extraction
- [ ] Duplicate detection

## License

See LICENSE file for details.

## Contributing

Contributions welcome! Please open an issue or submit a pull request.