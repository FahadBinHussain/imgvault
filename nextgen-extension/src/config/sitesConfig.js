// sitesConfig.js
// Configuration for site-specific quality warnings and recommendations

export const sitesConfig = {
  warningSites: [
    { url: 'airbnb.com', displayName: 'Airbnb' },
    { url: 'backiee.com', displayName: 'Backiee' },
    { url: 'artstation.com', displayName: 'ArtStation' },
    { url: 'drive.google.com', displayName: 'Google Drive' },
    { url: 'peakpx.com', displayName: 'PeakPX' },
    { url: 'sohu.com', displayName: 'Sohu' },
    { url: 'unsplash.com', displayName: 'Unsplash' },
    { url: 'wall.alphacoders.com', displayName: 'Alpha Coders' },
    { url: 'wallhere.com', displayName: 'WallHere' },
    { url: 'wallpaper.mob.org', displayName: 'Wallpaper Mob' }
  ],
  goodQualitySites: [
    { url: '10eastern.com', displayName: '10 Eastern' },
    { url: 'axoftglobal.ru', displayName: 'Axoft Global' },
    { url: 'divnil.com', displayName: 'Divnil' },
    { url: 'etsy.com', displayName: 'Etsy' },
    { url: 'facebook.com', displayName: 'Facebook' },
    { url: 'fbcdn.net', displayName: 'Facebook CDN' },
    { url: 'flickr.com', displayName: 'Flickr' },
    { url: 'glampinghub.com', displayName: 'Glamping Hub' },
    { url: 'goodfon.com', displayName: 'GoodFon' },
    { url: 'jngsainui.free.fr', displayName: 'JNGSainui' },
    { url: 'lexica.art', displayName: 'Lexica' },
    { url: 'note.com', displayName: 'Note' },
    { url: 'photos.google.com', displayName: 'Google Photos' },
    { url: 'pixiv.net', displayName: 'Pixiv' },
    { url: 'reddit.com', displayName: 'Reddit' },
    { url: 'tripadvisor.com', displayName: 'TripAdvisor' },
    { url: 'wallpaperflare.com', displayName: 'WallpaperFlare' },
    { url: 'wallpapercave.com', displayName: 'Wallpaper Cave' },
    { url: 'wallpapersden.com', displayName: 'WallpapersDen' },
    { url: 'yelp.com', displayName: 'Yelp' },
    { url: 'youtube.com', displayName: 'YouTube' }
  ],
};

// Helper functions to check if a URL matches any site in the lists
export const isWarningSite = (pageUrl) => {
  try {
    const hostname = new URL(pageUrl).hostname.toLowerCase();
    return sitesConfig.warningSites.some(site => hostname.includes(site.url));
  } catch (error) {
    const lowerUrl = pageUrl?.toLowerCase() || '';
    return sitesConfig.warningSites.some(site => lowerUrl.includes(site.url));
  }
};

export const isGoodQualitySite = (pageUrl) => {
  try {
    const hostname = new URL(pageUrl).hostname.toLowerCase();
    return sitesConfig.goodQualitySites.some(site => hostname.includes(site.url));
  } catch (error) {
    const lowerUrl = pageUrl?.toLowerCase() || '';
    return sitesConfig.goodQualitySites.some(site => lowerUrl.includes(site.url));
  }
};

export const getSiteDisplayName = (pageUrl, siteList) => {
  const lowerUrl = pageUrl?.toLowerCase() || '';
  const site = siteList.find(site => lowerUrl.includes(site.url));
  return site ? site.displayName : '';
};
