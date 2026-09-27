import type { BookDto } from '@/lib/api/types'
import { mediaIssue } from '@/lib/utils/mediaStatus'

/** Reader route for a book, or null when the web reader cannot display it (see mediaIssue). */
export function readRoute(book: Pick<BookDto, 'id' | 'media' | 'deleted'>): string | null {
  if (mediaIssue(book)) return null
  return `/book/${book.id}/read`
}

export function bookDetailRoute(book: Pick<BookDto, 'id'>): string {
  return `/book/${book.id}`
}
