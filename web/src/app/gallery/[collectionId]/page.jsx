import GalleryPage from '../page'

// /gallery/{collectionId} — the collection-scoped view reuses the gallery page;
// the shared component reads the matched param via useParams() and scopes itself.
export default function CollectionGalleryPage() {
  return <GalleryPage />
}
