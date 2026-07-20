import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border border-transparent font-medium tabular-nums transition-colors [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground",
				secondary: "bg-secondary text-secondary-foreground",
				outline: "border-border text-muted-foreground",
				accent: "bg-accent text-accent-foreground",
				success: "bg-success/12 text-success",
				destructive: "bg-destructive/12 text-destructive",
			},
			size: {
				default: "h-5.5 px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
				sm: "h-4.5 min-w-4.5 px-1.5 text-[0.7rem] [&_svg:not([class*='size-'])]:size-3",
			},
		},
		defaultVariants: {
			variant: "secondary",
			size: "default",
		},
	},
);

function Badge({
	className,
	variant,
	size,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return (
		<span
			data-slot="badge"
			className={cn(badgeVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
