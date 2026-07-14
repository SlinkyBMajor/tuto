declare module "*.md" {
	const content: string;
	export default content;
}

declare module "*.css";

// electrobun ships raw .ts sources that import optional GPU deps we don't use
declare module "three";
