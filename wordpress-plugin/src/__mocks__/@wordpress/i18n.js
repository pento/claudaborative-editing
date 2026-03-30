export const __ = (text) => text;
export const sprintf = (format, ...args) => {
	let i = 0;
	return format.replace(/%s/g, () => args[i++]);
};
export const _x = __;
export const _n = __;
export const _nx = __;
