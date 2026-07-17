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

function insertAsterisk(nodes: React.ReactNode, isRequired: boolean, alreadyHasMarker: boolean): React.ReactNode {
  if (!isRequired || alreadyHasMarker) return nodes;

  let inserted = false;

  function process(children: React.ReactNode): React.ReactNode {
    return React.Children.map(children, (child) => {
      if (inserted) return child;

      if (typeof child === "string" || typeof child === "number") {
        inserted = true;
        return (
          <>
            {child}
            <span className="required-marker" aria-hidden="true">*</span>
          </>
        );
      }

      if (React.isValidElement(child)) {
        const type = (child.type as any)?.displayName || (child.type as any)?.name || child.type;
        if (
          type === "Input" ||
          type === "Select" ||
          type === "Textarea" ||
          type === "input" ||
          type === "select" ||
          type === "textarea" ||
          type === "div"
        ) {
          return child;
        }

        const props: any = child.props || {};
        if (props.children) {
          const cleaned = process(props.children);
          if (inserted) {
            return React.cloneElement(child as React.ReactElement, { ...props, children: cleaned });
          }
        }
      }
      return child;
    });
  }

  const result = process(nodes);
  if (!inserted) {
    return (
      <>
        <span className="required-marker" aria-hidden="true">*</span>
        {nodes}
      </>
    );
  }
  return result;
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

  const content = insertAsterisk(cleanedChildren, isRequired, alreadyHasMarker);

  return (
    <label className={cn("ui-label", className)} {...domProps}>
      {content}
    </label>
  );
}

export default Label;
