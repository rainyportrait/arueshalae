import { useEffect, useRef } from "preact/hooks"

interface CaptchaModalProps {
	url: string
}

export function CaptchaModal({ url }: CaptchaModalProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)

	// Clean up modal on unmount
	useEffect(() => {
		return () => {
			if (modalRef.current?.parentNode) {
				modalRef.current.remove()
			}
		}
	}, [])

	const handleClose = () => {
		// Try to communicate with the iframe (in case it's same-origin or supports postMessage)
		iframeRef.current?.contentWindow?.postMessage("captcha_closed", "*")
		// DO NOT call markCaptchaResolved() - only the userscript should signal when the challenge is complete
	}

	return (
		<div ref={modalRef} class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
			<div class="absolute top-4 right-4 text-white text-4xl hover:text-gray-300 cursor-pointer" onClick={handleClose} title="Close captcha">
				×
			</div>
			<iframe ref={iframeRef} src={url} title="Captcha" class="w-[80%] max-w-[800px] h-[80%] max-h-[600px] border-none bg-white rounded-lg shadow-2xl" />
		</div>
	)
}
