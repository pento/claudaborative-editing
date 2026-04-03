const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { Resvg } = require('@resvg/resvg-js');

const assetsDir = join(__dirname, '..', '.wordpress-org');

// Icons (square, from icon.svg)
const iconSvg = readFileSync(join(assetsDir, 'icon.svg'), 'utf8');
for (const size of [128, 256]) {
	const resvg = new Resvg(iconSvg, {
		fitTo: { mode: 'width', value: size },
	});
	writeFileSync(
		join(assetsDir, `icon-${size}x${size}.png`),
		resvg.render().asPng()
	);
}

// Banners (from banner.svg, native 1544x500)
const bannerSvg = readFileSync(join(assetsDir, 'banner.svg'), 'utf8');
for (const [width, height] of [
	[772, 250],
	[1544, 500],
]) {
	const resvg = new Resvg(bannerSvg, {
		fitTo: { mode: 'width', value: width },
	});
	writeFileSync(
		join(assetsDir, `banner-${width}x${height}.png`),
		resvg.render().asPng()
	);
}
