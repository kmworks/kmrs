import type { KomfOAuthProvider } from '@/lib/api/types'
import { cn } from '@/lib/utils/cn'
import anilistLogo from '@/assets/trackers/anilist.png'
import malLogo from '@/assets/trackers/mal.svg'
import bangumiLogo from '@/assets/trackers/bangumi.svg'
import mangabakaLogo from '@/assets/trackers/mangabaka.png'

const LOGOS: Record<KomfOAuthProvider, string> = {
  anilist: anilistLogo,
  mal: malLogo,
  bangumi: bangumiLogo,
  mangabaka: mangabakaLogo,
}

export function TrackerLogo({ provider, className }: { provider: KomfOAuthProvider; className?: string }) {
  return (
    <img
      src={LOGOS[provider]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('shrink-0 select-none object-contain', className)}
    />
  )
}
