// gallery.js - Google Photos style gallery for ImgVault

let storageManager = null;
let allImages = [];
let currentImage = null;
let defaultGallerySource = 'imgbb'; // Default preference

// DOM Elements
const galleryContainer = document.getElementById('galleryContainer');
const galleryEmpty = document.getElementById('galleryEmpty');
const loadingSpinner = document.getElementById('loadingSpinner');
const refreshBtn = document.getElementById('refreshBtn');
const uploadBtn = document.getElementById('uploadBtn');
const searchInput = document.getElementById('searchInput');

const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const modalTitle = document.getElementById('modalTitle');
const modalFileName = document.getElementById('modalFileName');
const fileNameSection = document.getElementById('fileNameSection');
const displaySource = document.getElementById('displaySource');
const modalSourceUrlLink = document.getElementById('modalSourceUrlLink');
const modalPageUrlLink = document.getElementById('modalPageUrlLink');
const editSourceUrl = document.getElementById('editSourceUrl');
const editPageUrl = document.getElementById('editPageUrl');
const modalDate = document.getElementById('modalDate');
const modalNotes = document.getElementById('modalNotes');
const modalTags = document.getElementById('modalTags');
const closeModal = document.getElementById('closeModal');
const deleteImage = document.getElementById('deleteImage');
const downloadImagePixvidHeader = document.getElementById('downloadImagePixvidHeader');
const downloadImageImgbbHeader = document.getElementById('downloadImageImgbbHeader');
const notesSection = document.getElementById('notesSection');
const tagsSection = document.getElementById('tagsSection');

const confirmDialog = document.getElementById('confirmDialog');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOk = document.getElementById('confirmOk');
const confirmCancel = document.getElementById('confirmCancel');

const sourceIndicator = document.getElementById('sourceIndicator');

const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  storageManager = new StorageManager();
  
  // Load gallery source preference
  const settings = await chrome.storage.sync.get(['defaultGallerySource']);
  if (settings.defaultGallerySource) {
    defaultGallerySource = settings.defaultGallerySource;
    console.log('🔵 Default gallery source:', defaultGallerySource);
  }
  
  // Update source indicator
  updateSourceIndicator();
  
  await loadGallery();
  setupEventListeners();
});

function updateSourceIndicator() {
  if (defaultGallerySource === 'imgbb') {
    sourceIndicator.textContent = 'ImgBB';
    sourceIndicator.className = 'source-indicator imgbb';
    sourceIndicator.title = 'Displaying images from ImgBB when available';
  } else {
    sourceIndicator.textContent = 'Pixvid';
    sourceIndicator.className = 'source-indicator pixvid';
    sourceIndicator.title = 'Displaying images from Pixvid';
  }
}

function setupEventListeners() {
  refreshBtn.addEventListener('click', loadGallery);
  uploadBtn.addEventListener('click', () => {
    // Navigate to the popup page for uploading
    window.location.href = 'popup.html';
  });
  searchInput.addEventListener('input', handleSearch);
  closeModal.addEventListener('click', hideModal);
  document.querySelector('.modal-overlay').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      hideModal();
    }
  });
  deleteImage.addEventListener('click', confirmDelete);
  downloadImagePixvidHeader.addEventListener('click', () => handleDownload('pixvid'));
  downloadImageImgbbHeader.addEventListener('click', () => handleDownload('imgbb'));
  editSourceUrl.addEventListener('click', () => toggleEdit('source'));
  editPageUrl.addEventListener('click', () => toggleEdit('page'));
  
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
    console.log('� [GALLERY LOAD] Starting gallery load...');
    loadingSpinner.style.display = 'flex';
    galleryContainer.innerHTML = '';
    galleryEmpty.style.display = 'none';
    
    allImages = await storageManager.getAllImages();
    console.log(`� [GALLERY LOAD] Loaded ${allImages ? allImages.length : 0} images`);
    console.log('💡 [OPTIMIZATION] Only lightweight data loaded. Full details (hashes, dimensions, etc.) will load when you CLICK an image');
    
    loadingSpinner.style.display = 'none';
    
    if (!allImages || allImages.length === 0) {
      console.log('� [GALLERY LOAD] No images found, showing empty state');
      galleryEmpty.style.display = 'flex';
      return;
    }
    
    console.log('� [GALLERY LOAD] Displaying images in grid');
    displayImages(allImages);
  } catch (error) {
    console.error('🔴 Failed to load gallery:', error);
    loadingSpinner.style.display = 'none';
    alert(`Error loading images: ${error.message}\n\nPlease check your Firebase configuration in settings.`);
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
      // Use preference to determine which URL to display
      let imageUrl;
      if (defaultGallerySource === 'imgbb' && image.imgbbUrl) {
        imageUrl = image.imgbbUrl;
      } else if (defaultGallerySource === 'pixvid' || !image.imgbbUrl) {
        imageUrl = image.pixvidUrl;
      } else {
        // Fallback: use ImgBB if available, otherwise Pixvid
        imageUrl = image.imgbbUrl || image.pixvidUrl;
      }
      
      img.src = imageUrl;
      img.alt = image.pageTitle || 'Image';
      img.loading = 'lazy';
      
      const overlay = document.createElement('div');
      overlay.className = 'photo-overlay';
      
      // Show time if available
      if (image.createdAt) {
        const time = document.createElement('div');
        time.className = 'photo-time';
        time.textContent = new Date(image.createdAt).toLocaleTimeString('en-US', { 
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
      photoItem.addEventListener('click', async () => await showImageDetails(image));
      
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
    const date = image.createdAt ? new Date(image.createdAt) : new Date();
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
  // Set basic info immediately from lightweight data
  currentImage = image;
  
  // Reset delete button state
  deleteImage.disabled = false;
  deleteImage.textContent = '🗑️';
  
  // Reset edit buttons
  editSourceUrl.textContent = '✏️';
  editPageUrl.textContent = '✏️';
  editSourceUrl.classList.remove('saving');
  editPageUrl.classList.remove('saving');
  modalSourceUrlLink.style.display = 'inline';
  modalPageUrlLink.style.display = 'inline';
  
  // Determine which source to use based on preference
  let displayUrl, sourceName;
  if (defaultGallerySource === 'imgbb' && image.imgbbUrl) {
    displayUrl = image.imgbbUrl;
    sourceName = 'ImgBB';
  } else if (defaultGallerySource === 'pixvid') {
    displayUrl = image.pixvidUrl;
    sourceName = 'Pixvid';
  } else {
    // Fallback: use ImgBB if available, otherwise Pixvid
    displayUrl = image.imgbbUrl || image.pixvidUrl;
    sourceName = image.imgbbUrl ? 'ImgBB' : 'Pixvid';
  }
  
  // Store the current display source on the image object
  currentImage._displaySource = sourceName;
  currentImage._displayUrl = displayUrl;
  
  // Set the modal image
  modalImage.src = displayUrl;
  modalTitle.textContent = image.pageTitle || 'Untitled';
  
  // Display filename (will be populated when full data loads)
  fileNameSection.style.display = 'none';
  
  // Display Source indicator
  displaySource.textContent = `${sourceName} ⚡`;
  displaySource.style.color = sourceName === 'ImgBB' ? '#10b981' : '#818cf8';
  displaySource.style.fontWeight = '600';
  
  // Populate Pixvid and ImgBB URLs in Noobs tab
  const noobPixvidUrl = document.getElementById('noobPixvidUrl');
  const noobImgbbUrl = document.getElementById('noobImgbbUrl');
  const noobImgbbUrlSection = document.getElementById('noobImgbbUrlSection');
  
  if (noobPixvidUrl) {
    noobPixvidUrl.href = image.pixvidUrl;
    noobPixvidUrl.textContent = truncateUrl(image.pixvidUrl, 40);
  }
  
  if (image.imgbbUrl && noobImgbbUrlSection && noobImgbbUrl) {
    noobImgbbUrlSection.style.display = 'flex';
    noobImgbbUrl.href = image.imgbbUrl;
    noobImgbbUrl.textContent = truncateUrl(image.imgbbUrl, 40);
    // Show ImgBB download header button
    downloadImageImgbbHeader.style.display = 'flex';
  } else if (noobImgbbUrlSection) {
    noobImgbbUrlSection.style.display = 'none';
    // Hide ImgBB download header button
    downloadImageImgbbHeader.style.display = 'none';
  }
  
  // Source and Page URLs - both available in lightweight data now
  modalSourceUrlLink.href = image.sourceImageUrl || '#';
  modalSourceUrlLink.textContent = truncateUrl(image.sourceImageUrl || 'N/A', 50);
  modalPageUrlLink.href = image.sourcePageUrl || '#';
  modalPageUrlLink.textContent = truncateUrl(image.sourcePageUrl || 'N/A', 50);
  
  if (image.createdAt) {
    const date = new Date(image.createdAt);
    const dateStr = date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
    modalDate.textContent = dateStr;
  } else {
    modalDate.textContent = '';
  }
  
  // Always show description and tags sections with available data
  if (image.description) {
    console.log('Image has description:', image.description);
    modalNotes.textContent = image.description;
  } else {
    console.log('No description - showing empty');
    modalNotes.textContent = 'No description';
  }
  if (notesSection) {
    notesSection.style.display = '';
  }
  
  if (image.tags && image.tags.length > 0) {
    console.log('Image has tags:', image.tags);
    modalTags.innerHTML = image.tags.map(tag => 
      `<span class="modal-tag">${tag}</span>`
    ).join('');
  } else {
    console.log('No tags - showing empty');
    modalTags.innerHTML = '<span style="color: var(--text-muted); font-style: italic;">No tags</span>';
  }
  if (tagsSection) {
    tagsSection.style.display = '';
  }
  
  // Reset Nerds tab to show loading state
  const nerdDocId = document.getElementById('nerdDocId');
  const nerdFileType = document.getElementById('nerdFileType');
  const nerdFileSize = document.getElementById('nerdFileSize');
  const nerdDimensions = document.getElementById('nerdDimensions');
  const nerdSha256 = document.getElementById('nerdSha256');
  const nerdPHash = document.getElementById('nerdPHash');
  const nerdAHash = document.getElementById('nerdAHash');
  const nerdDHash = document.getElementById('nerdDHash');
  
  // Set loading placeholders
  if (nerdDocId) nerdDocId.textContent = image.id || 'N/A';
  if (nerdFileType) nerdFileType.textContent = 'Loading...';
  if (nerdFileSize) nerdFileSize.textContent = 'Loading...';
  if (nerdDimensions) nerdDimensions.textContent = 'Loading...';
  if (nerdSha256) nerdSha256.textContent = 'Loading...';
  if (nerdPHash) nerdPHash.textContent = 'Loading...';
  if (nerdAHash) nerdAHash.textContent = 'Loading...';
  if (nerdDHash) nerdDHash.textContent = 'Loading...';
  
  // Reset tabs to "For Noobs" when opening an image
  const tabs = document.querySelectorAll('.detail-tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(t => t.classList.remove('active'));
  tabContents.forEach(tc => {
    tc.classList.remove('active');
    tc.style.display = 'none';
  });
  
  // Activate the first tab (For Noobs)
  if (tabs[0]) tabs[0].classList.add('active');
  const noobsTab = document.getElementById('noobsTab');
  if (noobsTab) {
    noobsTab.classList.add('active');
    noobsTab.style.display = 'block';
  }
  
  // Show modal immediately with basic data
  imageModal.style.display = 'flex';
  
  // DO NOT lazy load here - wait until user clicks "For Nerds" tab
  console.log('💡 [OPTIMIZATION] Modal opened with lightweight data only. Full details will load when user clicks "For Nerds" tab');
}

// New function to lazy-load full image details
async function loadFullImageDetails(imageId) {
  try {
    console.log('� [USER CLICKED] Starting lazy load of full details for image:', imageId);
    console.log('⏱️  [TIMING] This data was NOT loaded with the gallery - loading NOW on demand');
    
    const fullImage = await storageManager.getImageById(imageId);
    
    if (!fullImage) {
      console.error('❌ Failed to load full image details');
      return;
    }
    
    // Update currentImage with full data
    currentImage = { ...currentImage, ...fullImage };
    
    console.log('✅ [LAZY LOAD] Full image details loaded successfully:', {
      fileName: fullImage.fileName,
      fileType: fullImage.fileType,
      fileSize: fullImage.fileSize,
      dimensions: `${fullImage.width}x${fullImage.height}`,
      sha256: fullImage.sha256 ? 'present' : 'missing',
      pHash: fullImage.pHash ? 'present' : 'missing',
      aHash: fullImage.aHash ? 'present' : 'missing',
      dHash: fullImage.dHash ? 'present' : 'missing'
    });
    
    // Update filename if available
    if (fullImage.fileName) {
      modalFileName.textContent = fullImage.fileName;
      fileNameSection.style.display = 'flex';
    }
    
    // Update Nerds tab with real data
    const nerdFileType = document.getElementById('nerdFileType');
    const nerdFileSize = document.getElementById('nerdFileSize');
    const nerdDimensions = document.getElementById('nerdDimensions');
    const nerdSha256 = document.getElementById('nerdSha256');
    const nerdPHash = document.getElementById('nerdPHash');
    const nerdAHash = document.getElementById('nerdAHash');
    const nerdDHash = document.getElementById('nerdDHash');
    
    if (nerdFileType) nerdFileType.textContent = fullImage.fileType || 'N/A';
    if (nerdFileSize) nerdFileSize.textContent = fullImage.fileSize ? `${(fullImage.fileSize / 1024).toFixed(2)} KB` : 'N/A';
    if (nerdDimensions) nerdDimensions.textContent = (fullImage.width && fullImage.height) ? `${fullImage.width} × ${fullImage.height}` : 'N/A';
    if (nerdSha256) nerdSha256.textContent = fullImage.sha256 || 'N/A';
    if (nerdPHash) nerdPHash.textContent = fullImage.pHash ? `${fullImage.pHash.substring(0, 64)}...` : 'N/A';
    if (nerdAHash) nerdAHash.textContent = fullImage.aHash || 'N/A';
    if (nerdDHash) nerdDHash.textContent = fullImage.dHash || 'N/A';
    
    console.log('✅ [UI UPDATE] Nerds tab populated with full technical details');
  } catch (error) {
    console.error('❌ Error loading full image details:', error);
    // Update to show error state
    const nerdElements = [
      'nerdFileType', 'nerdFileSize', 'nerdDimensions',
      'nerdSha256', 'nerdPHash', 'nerdAHash', 'nerdDHash'
    ];
    nerdElements.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.textContent === 'Loading...') {
        el.textContent = 'Error loading';
      }
    });
  }
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
      (image.pageTitle && image.pageTitle.toLowerCase().includes(query)) ||
      (image.description && image.description.toLowerCase().includes(query)) ||
      (image.tags && image.tags.some(tag => tag.toLowerCase().includes(query)))
    );
  });
  
  displayImages(filtered);
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
  
  // Capture image reference so delete can continue even if modal is closed
  const imageToDelete = { ...currentImage };
  
  try {
    // Disable button during deletion
    deleteImage.disabled = true;
    deleteImage.textContent = '⏳';
    
    // If we don't have delete URLs yet, fetch full details first
    if (!imageToDelete.pixvidDeleteUrl && !imageToDelete.imgbbDeleteUrl) {
      console.log('🔍 [DELETE] Delete URLs not loaded, fetching full details first...');
      showToast('Loading image details...', 3000);
      const fullDetails = await storageManager.getImageById(imageToDelete.id);
      if (fullDetails) {
        imageToDelete.pixvidDeleteUrl = fullDetails.pixvidDeleteUrl;
        imageToDelete.imgbbDeleteUrl = fullDetails.imgbbDeleteUrl;
      }
    }
    
    // Delete from Pixvid if pixvidDeleteUrl exists
    if (imageToDelete.pixvidDeleteUrl) {
      showToast('Deleting from Pixvid...', 5000);
      try {
        // Pixvid/Chevereto delete URLs work by simply visiting them
        await fetch(imageToDelete.pixvidDeleteUrl, {
          method: 'GET',
          redirect: 'follow'
        });
        
        // If we get here without errors, deletion was successful
        showToast('✓ Deleted from Pixvid', 2000);
      } catch (pixvidError) {
        showToast('⚠️ Pixvid deletion failed', 3000);
        console.warn('Pixvid deletion failed:', pixvidError);
      }
      
      // Wait a bit before showing next status
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Delete from ImgBB if imgbbDeleteUrl exists
    if (imageToDelete.imgbbDeleteUrl) {
      showToast('Deleting from ImgBB...', 5000);
      try {
        // Parse image ID and hash from delete URL
        // ImgBB delete URL format: https://ibb.co/$image_id/$image_hash
        const deleteUrl = new URL(imageToDelete.imgbbDeleteUrl);
        const pathParts = deleteUrl.pathname.split('/').filter(p => p);
        
        if (pathParts.length >= 2) {
          const imageId = pathParts[0];
          const imageHash = pathParts[1];
          
          // Create form data for deletion
          const formData = new FormData();
          formData.append('pathname', `/${imageId}/${imageHash}`);
          formData.append('action', 'delete');
          formData.append('delete', 'image');
          formData.append('from', 'resource');
          formData.append('deleting[id]', imageId);
          formData.append('deleting[hash]', imageHash);
          
          // Send POST request to ImgBB
          const response = await fetch('https://ibb.co/json', {
            method: 'POST',
            body: formData
          });
          
          if (response.ok) {
            showToast('✓ Deleted from ImgBB', 2000);
          } else {
            throw new Error(`ImgBB returned ${response.status}`);
          }
        } else {
          throw new Error('Invalid ImgBB delete URL format');
        }
      } catch (imgbbError) {
        showToast('⚠️ ImgBB deletion failed', 3000);
        console.warn('ImgBB deletion failed:', imgbbError);
      }
      
      // Wait a bit before showing next status
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Delete from Firebase
    showToast('Deleting from Firebase...', 5000);
    await storageManager.deleteImage(imageToDelete.id);
    
    // Verify deletion by checking if document still exists
    console.log('🔍 [DELETE] Verifying deletion...');
    showToast('Verifying deletion...', 3000);
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to ensure delete propagated
    
    const stillExists = await storageManager.getImageById(imageToDelete.id);
    
    if (stillExists) {
      throw new Error('Verification failed: Image still exists in Firebase after delete attempt');
    }
    
    console.log('✅ [DELETE] Verified: Image successfully deleted from Firebase');
    showToast('✓ Deleted from Firebase (verified)', 2000);
    
    // Wait a bit before showing final status
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Remove from allImages array
    allImages = allImages.filter(img => img.id !== imageToDelete.id);
    
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
    showToast(`❌ ${error.message || 'Failed to delete'}`, 4000);
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

async function handleDownload(source = 'pixvid') {
  if (!currentImage) return;
  
  try {
    let sourceUrl, sourceName, downloadBtn;
    
    if (source === 'imgbb') {
      sourceUrl = currentImage.imgbbUrl;
      sourceName = 'ImgBB';
      downloadBtn = downloadImageImgbbHeader;
    } else {
      sourceUrl = currentImage.pixvidUrl;
      sourceName = 'Pixvid';
      downloadBtn = downloadImagePixvidHeader;
    }
    
    if (!sourceUrl) {
      showToast('❌ Source not available', 2000);
      return;
    }
    
    downloadBtn.disabled = true;
    const originalHTML = downloadBtn.innerHTML;
    downloadBtn.innerHTML = '⏳';
    
    // Fetch the image from the source
    const response = await fetch(sourceUrl);
    const blob = await response.blob();
    
    // Extract filename from URL or use title
    const url = new URL(sourceUrl);
    const pathParts = url.pathname.split('/');
    const filename = pathParts[pathParts.length - 1] || `${currentImage.pageTitle || 'image'}.jpg`;
    
    // Create download link
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
    
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = originalHTML;
    showToast('✅ Image downloaded successfully', 2000);
  } catch (error) {
    console.error('Download failed:', error);
    if (source === 'imgbb') {
      downloadImageImgbb.disabled = false;
      downloadImageImgbb.innerHTML = '<span class="download-icon">⬇️</span> Download from ImgBB';
    } else {
      downloadImagePixvid.disabled = false;
      downloadImagePixvid.innerHTML = '<span class="download-icon">⬇️</span> Download from Pixvid';
    }
    showToast('❌ Download failed', 3000);
  }
}

async function toggleEdit(field) {
  const link = field === 'source' ? modalSourceUrlLink : modalPageUrlLink;
  const btn = field === 'source' ? editSourceUrl : editPageUrl;
  const editGroup = link.parentElement;
  
  // Check if we're in edit mode (input exists)
  const existingInput = editGroup.querySelector('input');
  
  if (!existingInput) {
    // Enter edit mode - replace link with input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'detail-input';
    input.value = link.href === '#' || link.href.endsWith('#') ? '' : link.href;
    input.style.flex = '1';
    
    link.style.display = 'none';
    editGroup.insertBefore(input, btn);
    
    input.focus();
    input.select();
    btn.textContent = '✓';
    btn.title = 'Save';
  } else {
    // Save mode
    try {
      btn.disabled = true;
      btn.classList.add('saving');
      btn.textContent = '⏳';
      
      const newValue = existingInput.value.trim();
      
      // Update in Firebase
      const updateData = {};
      if (field === 'source') {
        updateData.sourceImageUrl = newValue;
        currentImage.sourceImageUrl = newValue;
        link.href = newValue || '#';
        link.textContent = truncateUrl(newValue || 'N/A', 50);
      } else {
        updateData.sourcePageUrl = newValue;
        currentImage.sourcePageUrl = newValue;
        link.href = newValue || '#';
        link.textContent = truncateUrl(newValue || 'N/A', 50);
      }
      
      await storageManager.updateImage(currentImage.id, updateData);
      
      // Remove input and show link again
      existingInput.remove();
      link.style.display = 'inline';
      btn.textContent = '✏️';
      btn.title = 'Edit';
      btn.classList.remove('saving');
      btn.disabled = false;
      
      showToast('✅ URL updated successfully', 2000);
    } catch (error) {
      console.error('Failed to update URL:', error);
      showToast('❌ Failed to update URL', 3000);
      btn.textContent = '✏️';
      btn.classList.remove('saving');
      btn.disabled = false;
    }
  }
}


function truncateUrl(url, maxLength = 50) {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength) + '...';
}

// Tab switching functionality
document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.detail-tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  console.log('Tab switching initialized. Tabs found:', tabs.length, 'Contents found:', tabContents.length);
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-tab');
      console.log('Tab clicked:', tabName);
      
      // Remove active class from all tabs and contents
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => {
        tc.classList.remove('active');
        tc.style.display = 'none'; // Force hide
        console.log('Hiding tab:', tc.id);
      });
      
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Show corresponding content
      const targetContent = document.getElementById(`${tabName}Tab`);
      console.log('Target content:', targetContent, 'ID:', `${tabName}Tab`);
      if (targetContent) {
        targetContent.classList.add('active');
        targetContent.style.display = 'block'; // Force display
        console.log('Showing tab:', `${tabName}Tab`);
      }
      
      // Lazy load full details ONLY when "For Nerds" tab is clicked
      if (tabName === 'nerds' && currentImage) {
        console.log('🔍 [NERD TAB CLICKED] User wants to see technical details');
        // Check if we already have full details loaded (check for actual data, not a flag)
        if (!currentImage.sha256 || !currentImage.pHash || !currentImage.fileName) {
          console.log('💡 [LAZY LOAD TRIGGER] Full details not loaded yet - fetching now...');
          loadFullImageDetails(currentImage.id);
        } else {
          console.log('✅ [CACHE HIT] Full details already loaded, no need to fetch again');
        }
      }
    });
  });
});

