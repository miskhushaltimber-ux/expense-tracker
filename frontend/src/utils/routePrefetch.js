// 23 Sep, per Rishi: "it loads too much bro... if i hover on pages it loads
// for 1 or 3 seconds". Every dashboard page is its own lazy-loaded JS chunk
// (see router.jsx) so the app's initial download stays small — but that
// means the FIRST time you open a page, its code has to be fetched over the
// network before it can render. That fetch used to only start the instant
// you clicked the link, so the wait landed right when you were expecting
// the page to already be there.
//
// Starting the same fetch on HOVER instead (just before the click) hides
// that wait: by the time the click lands, the chunk is already loading or
// already sitting in the browser's cache. Total network time doesn't
// change, but it stops feeling like a delay. dynamic import() is
// deduplicated by the browser/Vite, so hovering the same link twice (or
// hovering then clicking) never fetches the chunk twice.
//
// These specifiers resolve to the exact same files router.jsx's lazy()
// calls import, so hovering a link warms the very same chunk that link's
// route will render — nothing is fetched twice or out of sync.
export const prefetchHome = () => import("../pages/Dashboard/Home");
export const prefetchExpenses = () => import("../pages/Dashboard/Expenses");
export const prefetchVehicles = () => import("../pages/Dashboard/Vehicles");
export const prefetchLaborWages = () => import("../pages/Dashboard/LaborWages");
export const prefetchManageData = () => import("../pages/Dashboard/ManageData");
export const prefetchDocuments = () => import("../pages/Dashboard/Documents");
export const prefetchTeam = () => import("../pages/Dashboard/Team");
