import { Link } from "./../router"

interface PaginationProps {
	currentPage?: number
	nextPid?: number
	lastPagePid?: number
	query?: string
}

const MAX_DISPLAY_PAGES = 5 // Show up to 5 page numbers at once

export function Pagination({ currentPage, nextPid, lastPagePid, query }: PaginationProps) {
	if (!currentPage) {
		return null
	}

	// Calculate the range of pages to display
	const halfDisplay = Math.floor(MAX_DISPLAY_PAGES / 2)
	let startPage = currentPage - halfDisplay
	let endPage = currentPage + halfDisplay

	// Calculate the last page number
	const lastPage = lastPagePid !== undefined ? Math.floor(lastPagePid / 42) + 1 : undefined

	// Clamp to valid range
	if (startPage < 1) {
		startPage = 1
		endPage = startPage + MAX_DISPLAY_PAGES - 1
	}

	// Clamp to last page if we know it
	if (lastPage !== undefined && endPage > lastPage) {
		endPage = lastPage
	}

	// Build page links
	const pageLinks = []
	for (let page = startPage; page <= endPage; page++) {
		pageLinks.push({ page, pid: (page - 1) * 42 })
	}

	return (
		<div class="mt-6 flex justify-center items-center gap-2 flex-wrap">
			{/* First page arrow */}
			{currentPage > 1 && (
				<Link
					href={`/posts?${query ? `query=${query}&` : ""}pid=0`}
					className="px-3 py-1 rounded hover:bg-gray-200"
					title="First page"
				>
					<>{`<<`}</>
				</Link>
			)}

			{/* Previous arrow */}
			{currentPage > 1 && (
				<Link
					href={`/posts?${query ? `query=${query}&` : ""}pid=${(currentPage - 2) * 42}`}
					className="px-3 py-1 rounded hover:bg-gray-200"
					title="Previous page"
				>
					<>{`<`}</>
				</Link>
			)}

			{/* Page numbers */}
			{pageLinks.map((link) => {
				const isCurrent = currentPage === link.page
				if (isCurrent) {
					return (
						<span
							key={link.page}
							class="px-3 py-1 rounded bg-blue-500 text-white"
						>
							<>{link.page}</>
						</span>
					)
				}
				return (
					<Link
						key={link.page}
						href={`/posts?${query ? `query=${query}&` : ""}pid=${link.pid}`}
						className="px-3 py-1 rounded hover:bg-gray-200"
					>
						<>{link.page}</>
					</Link>
				)
			})}

			{/* Next arrow */}
			{nextPid !== undefined && (
				<Link
					href={`/posts?${query ? `query=${query}&` : ""}pid=${nextPid}`}
					className="px-3 py-1 rounded hover:bg-gray-200"
					title="Next page"
				>
					<>{`>`}</>
				</Link>
			)}

			{/* Last page arrow - only show if there are more pages beyond current */}
			{lastPagePid !== undefined && nextPid !== undefined && (
				<Link
					href={`/posts?${query ? `query=${query}&` : ""}pid=${lastPagePid}`}
					className="px-3 py-1 rounded hover:bg-gray-200"
					title="Last page"
				>
					<>{`>>`}</>
				</Link>
			)}
		</div>
	)
}
