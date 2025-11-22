// gallery.js - Full-screen gallery view for ImgVault

let storageManager = null;
let allImages = [];
let currentImage = null;

// DOM Elements
const galleryGrid = document.getElementById('galleryGrid');
const galleryEmpty = document.getElementById('galleryEmpty');
const galleryCount = document.getElementById('galleryCount');
const loadingSpinner = document.getElementById('loadingSpinner');
const refreshBtn = document.getElementById('refreshBtn');
const searchInput = document.getElementById('searchInput');

const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const modalTitle = document.getElementById('modalTitle');
const modalSourceUrl = document.getElementById('modalSourceUrl');
const modalPageUrl = document.getElementById('modalPageUrl');
const modalDateValue = document.getElementById('modalDateValue');
const modalNotes = document.getElementById('modalNotes');
const modalTags = document.getElementById('modalTags');
const closeModal = document.getElementById('closeModal');
const copyImageUrl = document.getElementById('copyImageUrl');
const openOriginal = document.getElementById('openOriginal');
const modalDate = document.getElementById('modalDate');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  storageManager = new StorageManager();
  await loadGallery();
  setupEventListeners();
});

function setupEventListeners() {
  refreshBtn.addEventListener('click', loadGallery);
  searchInput.addEventListener('input', handleSearch);
  closeModal.addEventListener('click', hideModal);
  document.querySelector('.modal-overlay').addEventListener('click', hideModal);
  copyImageUrl.addEventListener('click', copyUrl);
  openOriginal.addEventListener('click', () => {
    if (currentImage) {
      window.open(currentImage.stored_url, '_blank');
    }
  });
  
  // ESC key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageModal.style.display !== 'none') {
      hideModal();
    }
  });
}

async function loadGallery() {
  try {
    loadingSpinner.style.display = 'flex';
    galleryGrid.innerHTML = '';
    galleryEmpty.style.display = 'none';
    
    allImages = await storageManager.getAllImages();
    
    loadingSpinner.style.display = 'none';
    
    if (!allImages || allImages.length === 0) {
      galleryEmpty.style.display = 'flex';
      galleryCount.textContent = 'No images';
      return;
    }
    
    displayImages(allImages);
  } catch (error) {
    console.error('Failed to load gallery:', error);
    loadingSpinner.style.display = 'none';
    galleryCount.textContent = 'Error loading images';
  }
}

function displayImages(images) {
  galleryGrid.innerHTML = '';
  galleryCount.textContent = `${images.length} image${images.length !== 1 ? 's' : ''}`;
  
  images.forEach(image => {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    
    item.innerHTML = `
      <img src="${image.stored_url}" alt="${image.page_title || 'Image'}" loading="lazy">
      <div class="gallery-item-overlay">
        <div class="gallery-item-title">${image.page_title || 'Untitled'}</div>
        ${image.tags && image.tags.length > 0 ? `
          <div class="gallery-item-tags">
            ${image.tags.slice(0, 3).map(tag => `<span class="gallery-tag">${tag}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
    
    item.addEventListener('click', () => showImageDetails(image));
    
    galleryGrid.appendChild(item);
  });
}

function showImageDetails(image) {
  currentImage = image;
  
  modalImage.src = image.stored_url;
  modalTitle.textContent = image.page_title || 'Untitled';
  
  modalSourceUrl.href = image.source_image_url;
  modalSourceUrl.textContent = truncateUrl(image.source_image_url, 50);
  
  modalPageUrl.href = image.source_page_url;
  modalPageUrl.textContent = truncateUrl(image.source_page_url, 50);
  
  if (image.created_at) {
    const date = new Date(image.created_at);
    modalDateValue.textContent = date.toLocaleString();
    modalDate.style.display = 'block';
  } else {
    modalDate.style.display = 'none';
  }
  
  if (image.notes) {
    modalNotes.textContent = image.notes;
    modalNotes.style.display = 'block';
  } else {
    modalNotes.style.display = 'none';
  }
  
  if (image.tags && image.tags.length > 0) {
    modalTags.innerHTML = image.tags.map(tag => 
      `<span class="modal-tag">${tag}</span>`
    ).join('');
    modalTags.style.display = 'flex';
  } else {
    modalTags.style.display = 'none';
  }
  
  imageModal.style.display = 'flex';
}

function hideModal() {
  imageModal.style.display = 'none';
  currentImage = null;
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  if (!query) {
    displayImages(allImages);
    return;
  }
  
  const filtered = allImages.filter(image => {
    return (
      (image.page_title && image.page_title.toLowerCase().includes(query)) ||
      (image.notes && image.notes.toLowerCase().includes(query)) ||
      (image.tags && image.tags.some(tag => tag.toLowerCase().includes(query)))
    );
  });
  
  displayImages(filtered);
}

async function copyUrl() {
  if (!currentImage) return;
  
  try {
    await navigator.clipboard.writeText(currentImage.stored_url);
    copyImageUrl.textContent = '✓ Copied!';
    setTimeout(() => {
      copyImageUrl.textContent = '📋 Copy Image URL';
    }, 2000);
  } catch (error) {
    console.error('Failed to copy:', error);
  }
}

function truncateUrl(url, maxLength = 50) {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + '...';
}
