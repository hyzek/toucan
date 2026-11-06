export function ToucanLogo({ compact = false }: { compact?: boolean }) {
	return (
		<svg className={`toucan-logo ${compact ? "compact" : ""}`} viewBox="0 0 4 4" role="img" aria-label="Toucan">
			<title>Toucan</title>
			<rect className="toucan-logo-coral" width="3" height="1" />
			<rect className="toucan-logo-coral" x="2" y="1" width="1" height="1" />
			<rect className="toucan-logo-blue" y="1" width="1" height="3" />
			<rect className="toucan-logo-blue" x="1" y="2" width="1" height="1" />
			<rect className="toucan-logo-yellow" x="3" y="2" width="1" height="2" />
		</svg>
	);
}
