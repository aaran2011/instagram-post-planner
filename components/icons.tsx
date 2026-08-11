import React from "react";

type P = React.SVGProps<SVGSVGElement> & { size?: number };
const S = ({ size = 20, children, ...p }: P & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    {children}
  </svg>
);

export const IconUpload = (p: P) => (
  <S {...p}><path d="M12 16V4" /><path d="m6 10 6-6 6 6" /><path d="M4 20h16" /></S>
);
export const IconGrid = (p: P) => (
  <S {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></S>
);
export const IconCalendar = (p: P) => (
  <S {...p}><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2v4M16 2v4" /></S>
);
export const IconRocket = (p: P) => (
  <S {...p}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="M12 15l-3-3a22 22 0 0 1 8-10c1.5 1.5 2.5 4 2 8a22 22 0 0 1-7 5z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></S>
);
export const IconBolt = (p: P) => (
  <S {...p}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></S>
);
export const IconSettings = (p: P) => (
  <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></S>
);
export const IconInstagram = (p: P) => (
  <S {...p}><rect x="2" y="2" width="20" height="20" rx="5.5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></S>
);
export const IconHeart = (p: P) => (
  <S {...p}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" /></S>
);
export const IconComment = (p: P) => (
  <S {...p}><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.6 8.6 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z" /></S>
);
export const IconShare = (p: P) => (
  <S {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></S>
);
export const IconBookmark = (p: P) => (
  <S {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></S>
);
export const IconPlay = (p: P) => (
  <S {...p} fill="currentColor" stroke="none"><path d="M8 5v14l11-7z" /></S>
);
export const IconPause = (p: P) => (
  <S {...p} fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></S>
);
export const IconVideo = (p: P) => (
  <S {...p}><rect x="2" y="6" width="14" height="12" rx="2.5" /><path d="m16 10 6-3v10l-6-3z" /></S>
);
export const IconReel = (p: P) => (
  <S {...p}><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m9 3 3 6M15 3l3 6M3 9h18M10 13l5 2.5L10 18z" /></S>
);
export const IconClose = (p: P) => (<S {...p}><path d="M18 6 6 18M6 6l12 12" /></S>);
export const IconCheck = (p: P) => (<S {...p}><path d="M20 6 9 17l-5-5" /></S>);
export const IconTrash = (p: P) => (
  <S {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></S>
);
export const IconPlus = (p: P) => (<S {...p}><path d="M12 5v14M5 12h14" /></S>);
export const IconRefresh = (p: P) => (
  <S {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></S>
);
export const IconEdit = (p: P) => (
  <S {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></S>
);
export const IconClock = (p: P) => (<S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>);
export const IconMusic = (p: P) => (
  <S {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></S>
);
export const IconMenu = (p: P) => (<S {...p}><path d="M3 6h18M3 12h18M3 18h18" /></S>);
export const IconChevronL = (p: P) => (<S {...p}><path d="m15 18-6-6 6-6" /></S>);
export const IconChevronR = (p: P) => (<S {...p}><path d="m9 6 6 6-6 6" /></S>);
export const IconAlert = (p: P) => (
  <S {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></S>
);
export const IconLogout = (p: P) => (
  <S {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></S>
);
export const IconSparkle = (p: P) => (
  <S {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></S>
);
export const IconEye = (p: P) => (
  <S {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></S>
);
export const IconLink = (p: P) => (
  <S {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></S>
);
