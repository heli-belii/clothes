import { forwardRef } from "react";

// Wardrobe images are served by the local API; keep the original URL intact.
export const OptimizedImage = forwardRef(function OptimizedImage({
  src,
  alt = "",
  sizes = "100vw",
  breakpoints,
  quality,
  priority = false,
  loading,
  decoding,
  ...props
}, ref) {
  return <img ref={ref} src={src} alt={alt} sizes={sizes} loading={loading || (priority ? "eager" : "lazy")} decoding={decoding || "async"} {...props} />;
});
