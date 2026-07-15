import * as React from "react";
import { cn } from "../../lib/cn";

type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean };

function hasRequiredChild(children: React.ReactNode): boolean {
  let found = false;
  React.Children.forEach(children, (child) => {
    if (found) return;
    if (React.isValidElement(child)) {
      const props: any = (child as any).props || {};
      if (props.required === true || props["aria-required"] === true || props["aria-required"] === "true") {
        found = true;
        return;
      }
      // recurse into child props.children
      if (props.children) {
        if (hasRequiredChild(props.children)) {
          found = true;
          return;
        }
      }
    }
  });
  return found;
}

function containsExistingMarker(children: React.ReactNode): boolean {
  let found = false;
  React.Children.forEach(children, (child) => {
    if (found) return;
    if (React.isValidElement(child)) {
      const props: any = (child as any).props || {};
      const className = String(props.className || "");
      if (className.includes("required-marker") || className.includes("required-star")) {
        found = true;
        return;
      }
      if (props.children) {
        if (containsExistingMarker(props.children)) {
          found = true;
          return;
        }
      }
    }
  });
  return found;
}

function stripTrailingAsteriskFromStringNode(text: string) {
  // remove trailing asterisks and any preceding spaces
  return text.replace(/\s*\*+\s*$/u, "");
}

function cleanChildren(nodes: React.ReactNode): React.ReactNode {
  // Remove trailing literal '*' from string children to avoid duplicate markers
  return React.Children.map(nodes, (child) => {
    if (typeof child === "string") {
      return stripTrailingAsteriskFromStringNode(child);
    }
    if (React.isValidElement(child)) {
      const props: any = (child as any).props || {};
      const cleaned = props.children ? cleanChildren(props.children) : props.children;
      if (cleaned === props.children) return child;
      return React.cloneElement(child as React.ReactElement, { ...props, children: cleaned });
    }
    return child;
  });
}

function Label({ className, children, required, ...props }: LabelProps) {
  // Determine requiredness from explicit prop, or from child inputs (e.g., <Input required />)
  const requiredFromChild = hasRequiredChild(children);
  const isRequired = required === true || requiredFromChild || props["aria-required"] === "true" || props["aria-required"] === true;

  const cleanedChildren = cleanChildren(children);
  const alreadyHasMarker = containsExistingMarker(children);

  // Avoid passing the custom `required` prop to the DOM label element
  const domProps = { ...props } as React.LabelHTMLAttributes<HTMLLabelElement>;
  delete (domProps as any).required;

  return (
    <label className={cn("ui-label", className)} {...domProps}>
      {cleanedChildren}
      {isRequired && !alreadyHasMarker && <span className="required-marker" aria-hidden="true">*</span>}
    </label>
  );
}

export default Label;
