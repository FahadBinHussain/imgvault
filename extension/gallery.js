// gallery.js - Google Photos style gallery for ImgVault

let storageManager = null;
let allImages = [];
let currentImage = null;

// DOM Elements
const galleryContainer = document.getElementById('galleryContainer');
const galleryEmpty = document.getElementById('galleryEmpty');
const loadingSpinner = document.getElementById('loadingSpinner');
const refreshBtn = document.getElementById('refreshBtn');
const searchInput = document.getElementById('searchInput');

const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const modalTitle = document.getElementById('modalTitle');
const modalSourceUrl = document.getElementById('modalSourceUrl');
const modalPageUrl = document.getElementById('modalPageUrl');
const modalDate = document.getElementById('modalDate');
const modalNotes = document.getElementById('modalNotes');
const modalTags = document.getElementById('modalTags');
const closeModal = document.getElementById('closeModal');
const copyImageUrl = document.getElementById('copyImageUrl');
const openOriginal = document.getElementById('openOriginal');
const deleteImage = document.getElementById('deleteImage');
const notesSection = document.getElementById('notesSection');
const tagsSection = document.getElementById('tagsSection');

const confirmDialog = document.getElementById('confirmDialog');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOk = document.getElementById('confirmOk');
const confirmCancel = document.getElementById('confirmCancel');

const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

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
  deleteImage.addEventListener('click', confirmDelete);
  openOriginal.addEventListener('click', () => {
    if (currentImage) {
      window.open(currentImage.stored_url, '_blank');
    }
  });
  
  confirmCancel.addEventListener('click', hideConfirm);
  document.querySelector('.confirm-overlay').addEventListener('click', hideConfirm);
  
  // ESC key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (confirmDialog.style.display !== 'none') {
        hideConfirm();
      } else if (imageModal.style.display !== 'none') {
        hideModal();
      }
    }
  });
}

async function loadGallery() {
  try {
    loadingSpinner.style.display = 'flex';
    galleryContainer.innerHTML = '';
    galleryEmpty.style.display = 'none';
    
    allImages = await storageManager.getAllImages();
    
    loadingSpinner.style.display = 'none';
    
    if (!allImages || allImages.length === 0) {
      galleryEmpty.style.display = 'flex';
      return;
    }
    
    displayImages(allImages);
  } catch (error) {
    console.error('Failed to load gallery:', error);
    loadingSpinner.style.display = 'none';
    alert('Error loading images. Please check your Firebase configuration.');
  }
}

function displayImages(images) {
  galleryContainer.innerHTML = '';
  
  // Group images by date
  const grouped = groupImagesByDate(images);
  
  // Display each date section
  Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a)).forEach(dateKey => {
    const dateSection = document.createElement('div');
    dateSection.className = 'date-section';
    
    const dateHeader = document.createElement('div');
    dateHeader.className = 'date-header';
    dateHeader.textContent = formatDateHeader(dateKey);
    
    const photosGrid = document.createElement('div');
    photosGrid.className = 'photos-grid';
    
    grouped[dateKey].forEach(image => {
      const photoItem = document.createElement('div');
      photoItem.className = 'photo-item';
      
      const img = document.createElement('img');
      img.src = image.stored_url;
      img.alt = image.page_title || 'Image';
      img.loading = 'lazy';
      
      const overlay = document.createElement('div');
      overlay.className = 'photo-overlay';
      
      // Show time if available
      if (image.created_at) {
        const time = document.createElement('div');
        time.className = 'photo-time';
        time.textContent = new Date(image.created_at).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit' 
        });
        overlay.appendChild(time);
      }
      
      // Show tags
      if (image.tags && image.tags.length > 0) {
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'photo-tags';
        image.tags.slice(0, 2).forEach(tag => {
          const tagEl = document.createElement('span');
          tagEl.className = 'photo-tag';
          tagEl.textContent = tag;
          tagsContainer.appendChild(tagEl);
        });
        overlay.appendChild(tagsContainer);
      }
      
      photoItem.appendChild(img);
      photoItem.appendChild(overlay);
      photoItem.addEventListener('click', () => showImageDetails(image));
      
      photosGrid.appendChild(photoItem);
    });
    
    dateSection.appendChild(dateHeader);
    dateSection.appendChild(photosGrid);
    galleryContainer.appendChild(dateSection);
  });
}

function groupImagesByDate(images) {
  const grouped = {};
  
  images.forEach(image => {
    const date = image.created_at ? new Date(image.created_at) : new Date();
    const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
    
    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }
    grouped[dateKey].push(image);
  });
  
  return grouped;
}

function formatDateHeader(dateStr) {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const dateKey = date.toISOString().split('T')[0];
  const todayKey = today.toISOString().split('T')[0];
  const yesterdayKey = yesterday.toISOString().split('T')[0];
  
  if (dateKey === todayKey) {
    return 'Today';
  } else if (dateKey === yesterdayKey) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }
}

function showImageDetails(image) {
  currentImage = image;
  
  // Reset delete button state
  deleteImage.disabled = false;
  deleteImage.textContent = '🗑️';
  
  modalImage.src = image.stored_url;
  modalTitle.textContent = image.page_title || 'Untitled';
  
  modalSourceUrl.href = image.source_image_url;
  modalSourceUrl.textContent = truncateUrl(image.source_image_url, 40);
  
  modalPageUrl.href = image.source_page_url;
  modalPageUrl.textContent = truncateUrl(image.source_page_url, 40);
  
  if (image.created_at) {
    const date = new Date(image.created_at);
    modalDate.textContent = date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } else {
    modalDate.textContent = '';
  }
  
  if (image.notes) {
    modalNotes.textContent = image.notes;
    notesSection.style.display = 'block';
  } else {
    notesSection.style.display = 'none';
  }
  
  if (image.tags && image.tags.length > 0) {
    modalTags.innerHTML = image.tags.map(tag => 
      `<span class="modal-tag">${tag}</span>`
    ).join('');
    tagsSection.style.display = 'block';
  } else {
    tagsSection.style.display = 'none';
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
    showToast('Link copied to clipboard');
  } catch (error) {
    console.error('Failed to copy:', error);
    showToast('Failed to copy link');
  }
}

function confirmDelete() {
  if (!currentImage) return;
  
  confirmTitle.textContent = 'Delete Image?';
  confirmMessage.textContent = 'This will permanently delete the image from both your vault and Pixvid. This action cannot be undone.';
  confirmDialog.style.display = 'flex';
  
  // Set up one-time click handler for confirm
  confirmOk.onclick = handleDelete;
}

function hideConfirm() {
  confirmDialog.style.display = 'none';
  confirmOk.onclick = null;
}

async function handleDelete() {
  hideConfirm();
  
  if (!currentImage) return;
  
  try {
    // Disable button during deletion
    deleteImage.disabled = true;
    deleteImage.textContent = '⏳';
    
    // Delete from Pixvid if delete_url exists
    if (currentImage.delete_url) {
      showToast('Deleting from Pixvid...', 5000);
      try {
        const pixvidResponse = await fetch(currentImage.delete_url);
        if (!pixvidResponse.ok) {
          showToast('⚠️ Failed to delete from Pixvid', 3000);
          console.warn('Failed to delete from Pixvid');
        } else {
          showToast('✓ Deleted from Pixvid', 2000);
        }
      } catch (pixvidError) {
        showToast('⚠️ Pixvid deletion failed', 3000);
        console.warn('Pixvid deletion failed:', pixvidError);
      }
      
      // Wait a bit before showing next status
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Delete from Firebase
    showToast('Deleting from Firebase...', 5000);
    await storageManager.deleteImage(currentImage.id);
    showToast('✓ Deleted from Firebase', 2000);
    
    // Wait a bit before showing final status
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Remove from allImages array
    allImages = allImages.filter(img => img.id !== currentImage.id);
    
    // Close modal and refresh gallery
    hideModal();
    displayImages(allImages);
    
    // Show empty state if no images left
    if (allImages.length === 0) {
      galleryContainer.innerHTML = '';
      galleryEmpty.style.display = 'flex';
    }
    
    showToast('✅ Image deleted successfully', 3000);
  } catch (error) {
    console.error('Failed to delete image:', error);
    showToast('❌ Failed to delete from Firebase', 4000);
    deleteImage.disabled = false;
    deleteImage.textContent = '🗑️';
  }
}

function showToast(message, duration = 3000) {
  toastMessage.textContent = message;
  toast.style.display = 'block';
  toast.classList.remove('hiding');
  
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => {
      toast.style.display = 'none';
      toast.classList.remove('hiding');
    }, 300);
  }, duration);
}

function truncateUrl(url, maxLength = 50) {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + '...';
}
