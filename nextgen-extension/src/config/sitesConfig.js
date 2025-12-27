// sitesConfig.js
// Configuration for site-specific quality warnings and recommendations

export const sitesConfig = {
  warningSites: [
    { url: 'drive.google.com', displayName: 'Google Drive' },
    { url: 'unsplash.com', displayName: 'Unsplash' },
    { url: 'wallpaper.mob.org', displayName: 'Wallpaper Mob' },
    { url: 'artstation.com', displayName: 'ArtStation' },
    { url: 'backiee.com', displayName: 'Backiee' },
    { url: 'wall.alphacoders.com', displayName: 'Alpha Coders' },
    { url: 'peakpx.com', displayName: 'PeakPX' },
    { url: 'airbnb.com', displayName: 'Airbnb' },
    { url: 'wallhere.com', displayName: 'WallHere' },
    { url: 'sohu.com', displayName: 'Sohu' }
  ],
  goodQualitySites: [
    { url: 'facebook.com', displayName: 'Facebook' },
    { url: 'instagram.com', displayName: 'Instagram' },
    { url: 'slideshare.net', displayName: 'SlideShare' },
    { url: 'flickr.com', displayName: 'Flickr' },
    { url: 'wallpapercave.com', displayName: 'Wallpaper Cave' },
    { url: 'jngsainui.free.fr', displayName: 'JNGSainui' },
    { url: 'yelp.com', displayName: 'Yelp' },
    { url: 'divnil.com', displayName: 'Divnil' },
    { url: 'note.com', displayName: 'Note' },
    { url: 'goodfon.com', displayName: 'GoodFon' },
    { url: 'reddit.com', displayName: 'Reddit' },
    { url: 'wallpapersden.com', displayName: 'WallpapersDen' },
    { url: 'glampinghub.com', displayName: 'Glamping Hub' },
    { url: 'etsy.com', displayName: 'Etsy' },
    { url: 'tripadvisor.com', displayName: 'TripAdvisor' },
    { url: 'axoftglobal.ru', displayName: 'Axoft Global' },
    { url: '10eastern.com', displayName: '10 Eastern' },
  ],
};

// Helper functions to check if a URL matches any site in the lists
export const isWarningSite = (pageUrl) => {
  const lowerUrl = pageUrl?.toLowerCase() || '';
  return sitesConfig.warningSites.some(site => lowerUrl.includes(site.url));
};

export const isGoodQualitySite = (pageUrl) => {
  const lowerUrl = pageUrl?.toLowerCase() || '';
  return sitesConfig.goodQualitySites.some(site => lowerUrl.includes(site.url));
};

export const getSiteDisplayName = (pageUrl, siteList) => {
  const lowerUrl = pageUrl?.toLowerCase() || '';
  const site = siteList.find(site => lowerUrl.includes(site.url));
  return site ? site.displayName : '';
};