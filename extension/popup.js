// State management
let imageData = null;
let isEditingPageUrl = false;

// DOM elements
const noImageState = document.getElementById('noImageState');
const imageState = document.getElementById('imageState');
const previewImage = document.getElementById('previewImage');
const imageUrlInput = document.getElementById('imageUrl');
const pageUrlInput = document.getElementById('pageUrl');
const pageTitleInput = document.getElementById('pageTitle');
const notesInput = document.getElementById('notes');
const tagsInput = document.getElementById('tags');
const uploadBtn = document.getElementById('uploadBtn');
const statusMessage = document.getElementById('statusMessage');
const editPageUrlBtn = document.getElementById('editPageUrl');
const copyImageUrlBtn = document.getElementById('copyImageUrl');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Check if there's pending image data
  const { pendingImage } = await chrome.storage.local.get('pendingImage');
  
  if (pendingImage) {
    imageData = pendingImage;
    displayImage(imageData);
    // Clear the pending image
    chrome.storage.local.remove('pendingImage');
  }
});

// Display image function
function displayImage(data) {
  noImageState.style.display = 'none';
  imageState.style.display = 'block';
  
  previewImage.src = data.imageUrl;
  imageUrlInput.value = data.imageUrl;
  pageUrlInput.value = data.pageUrl;
  pageTitleInput.value = data.pageTitle || 'Untitled Page';
}

// Edit page URL
editPageUrlBtn.addEventListener('click', () => {
  if (!isEditingPageUrl) {
    pageUrlInput.removeAttribute('readonly');
    pageUrlInput.classList.add('editing');
    pageUrlInput.focus();
    pageUrlInput.select();
    editPageUrlBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
    editPageUrlBtn.title = 'Save';
    isEditingPageUrl = true;
  } else {
    pageUrlInput.setAttribute('readonly', 'true');
    pageUrlInput.classList.remove('editing');
    editPageUrlBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    `;
    editPageUrlBtn.title = 'Edit';
    isEditingPageUrl = false;
  }
});

// Copy image URL
copyImageUrlBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(imageUrlInput.value);
    showStatus('URL copied to clipboard!', 'success');
  } catch (err) {
    showStatus('Failed to copy URL', 'error');
  }
});

// Upload button
uploadBtn.addEventListener('click', async () => {
  if (!imageData) {
    showStatus('No image data available', 'error');
    return;
  }

  uploadBtn.disabled = true;
  showStatus('Uploading image...', 'loading');

  try {
    // Fetch the image as blob
    const response = await fetch(imageData.imageUrl);
    const blob = await response.blob();

    // Prepare form data
    const formData = new FormData();
    formData.append('file', blob, `image_${Date.now()}.${getFileExtension(imageData.imageUrl)}`);
    formData.append('source_image_url', imageData.imageUrl);
    formData.append('source_page_url', pageUrlInput.value);
    formData.append('page_title', pageTitleInput.value);
    formData.append('notes', notesInput.value);
    formData.append('tags', tagsInput.value);

    // Upload to backend
    const uploadResponse = await fetch('http://localhost:8080/api/upload', {
      method: 'POST',
      body: formData
    });

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json();
      throw new Error(errorData.error || 'Upload failed');
    }

    const result = await uploadResponse.json();
    showStatus('✓ Image saved to vault successfully!', 'success');

    // Clear form after 2 seconds
    setTimeout(() => {
      resetForm();
    }, 2000);

  } catch (error) {
    console.error('Upload error:', error);
    showStatus(`Upload failed: ${error.message}`, 'error');
  } finally {
    uploadBtn.disabled = false;
  }
});

// Utility functions
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';

  if (type !== 'loading') {
    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 5000);
  }
}

function getFileExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop();
    return ext || 'jpg';
  } catch {
    return 'jpg';
  }
}

function resetForm() {
  imageData = null;
  noImageState.style.display = 'block';
  imageState.style.display = 'none';
  notesInput.value = '';
  tagsInput.value = '';
  statusMessage.style.display = 'none';
}
