// Exported from the Figma file and committed, rather than referenced from the
// Figma asset URLs -- those expire after about a week.
export const icons = {
  logo: "/icons/logo.svg",
  mark: "/icons/mark.svg",
  search: "/icons/search.svg",
  searchSm: "/icons/search-sm.svg",
  dollar: "/icons/dollar.svg",
  edit: "/icons/edit.svg",
  home: "/icons/home.svg",
  arrowLeft: "/icons/arrow-left.svg",
  arrowRight: "/icons/arrow-right.svg",
  /* One ring for both carousel arrows. They were two files that differed only
     by a baked-in opacity="0.4" on the left one -- the design's way of drawing
     the at-the-start state, which the disabled styling now handles. */
  circleRing: "/icons/circle-ring.svg",
  cross: "/icons/cross.svg",
  google: "/icons/google.svg",
  drag: "/icons/drag.svg",
  back: "/icons/back.svg",
  heart: "/icons/heart.svg",
  heartOutline: "/icons/heart-outline.svg",
  circleBtn: "/icons/circle-btn.svg",
  chevron: "/icons/chevron.svg",
  iconCar: "/icons/icon-car.svg",
  iconWarn: "/icons/icon-warn.svg",
  iconMoney: "/icons/icon-money.svg",
  dot: "/icons/dot.svg",
  modeTransit: "/icons/mode-transit.svg",
  modeBicycling: "/icons/mode-bicycling.svg",
  modeWalking: "/icons/mode-walking.svg",
  /** Green tick marking the better listing on the comparison page. */
  check: "/icons/check.svg",
  expandRing: "/icons/expand-ring.svg",
  expand: "/icons/expand.svg",
  /**
   * Figma nodes 2181:7598 and 2181:7597. Whole controls rather than glyphs --
   * each carries its own 39px circle -- so they are drawn at full size on a
   * bare button, not dropped inside one of the app's own.
   */
  panelExpand: "/icons/panel-expand.svg",
  panelMinimize: "/icons/panel-minimize.svg",
} as const;
