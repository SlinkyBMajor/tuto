declare module "*.md" {
	const content: string;
	export default content;
}

declare module "*.css";

// Vite emits an asset URL for image imports
declare module "*.png" {
	const src: string;
	export default src;
}

// electrobun ships raw .ts sources that import optional GPU deps we don't use
declare module "three";
