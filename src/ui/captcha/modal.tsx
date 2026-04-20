interface CaptchaModalProps {
	url: string
}

export function CaptchaModal({ url }: CaptchaModalProps) {
	return (
		<div class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
			<iframe
				src={url}
				title="Captcha"
				class="w-[80%] max-w-200 h-[80%] max-h-150 border-none bg-white rounded-lg shadow-2xl"
			/>
		</div>
	)
}
