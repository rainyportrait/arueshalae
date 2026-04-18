import { Link } from "./../router"
import type { PageLink } from "./posts"

interface PaginationProps {
	currentPage?: number
	pageLinks: PageLink[]
	nextPid?: number
	lastPid?: number
	query?: string
}

export function Pagination({ currentPage, pageLinks, nextPid, lastPid, query }: PaginationProps) {
	if (pageLinks.length === 0 && !nextPid && !lastPid) {
		return null
	}

	return (
		<div class="mt-6 flex justify-center items-center gap-2 flex-wrap">
			{/* First page */}
			{pageLinks.length > 0 && (
				<Link
					href={`/posts?${query ? `query=${query}&` : ""}pid=${pageLinks[0].pid}`}
					className="px-3 py-1 rounded hover:bg-gray-200"
				>
					<>{1}</>
				</Link>
			)}

			{/* Page numbers */}
			{pageLinks.map((link) => {
				if (link.page === 1) return null // Skip if already shown as first
				const isCurrent = currentPage === link.page
				return (
					<Link
						key={link.page}
						href={`/posts?${query ? `query=${query}&` : ""}pid=${link.pid}`}
						className={`px-3 py-1 rounded ${
							isCurrent ? "bg-blue-500 text-white" : "hover:bg-gray-200"
						}`}
					>
						<>{link.page}</>
					</Link>
				)
			})}

			{/* Next page */}
			{nextPid && (
				<Link
					href={`/posts?${query ? `query=${query}&` : ""}pid=${nextPid}`}
					className="px-3 py-1 rounded hover:bg-gray-200"
					title="Next page"
				>
					<>{`>`}</>
				</Link>
			)}

			{/* Last page */}
			{lastPid && (
				<Link
					href={`/posts?${query ? `query=${query}&` : ""}pid=${lastPid}`}
					className="px-3 py-1 rounded hover:bg-gray-200"
					title="Last page"
				>
					<>{`>>`}</>
				</Link>
			)}
		</div>
	)
}
