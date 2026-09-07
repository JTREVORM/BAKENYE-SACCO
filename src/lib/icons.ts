/**
 * The complete set of Material Symbols glyphs this application renders.
 *
 * Google Fonts serves a subsetted font when you pass `icon_names`, so this list
 * is the difference between shipping the full ~350KB variable icon font and
 * shipping roughly 15KB. On a low-end Android phone over 3G that is the single
 * biggest asset win available to us.
 *
 * If you add an icon to a component, add its name here or it will render as
 * the literal ligature text.
 */
export const ICON_NAMES = [
  // Navigation - matches the Stitch sidebar and bottom bar
  'dashboard', 'group', 'groups', 'pie_chart', 'account_balance_wallet', 'payments',
  'receipt_long', 'account_balance', 'assessment', 'manage_accounts', 'policy',
  'home', 'history', 'menu', 'settings', 'close',
  // Transactions
  'savings', 'credit_score', 'add_circle', 'remove_circle', 'trending_up',
  'trending_down', 'receipt', 'gavel', 'swap_horiz', 'undo',
  // Actions
  'add', 'remove', 'edit', 'delete', 'check', 'check_circle', 'done_all', 'search',
  'filter_list', 'tune', 'sort', 'refresh', 'download', 'print', 'share',
  'visibility', 'visibility_off', 'upload_file', 'attach_file', 'content_copy',
  // Status and feedback
  'error', 'warning', 'info', 'schedule', 'pending', 'block', 'verified',
  'inbox', 'cloud_off', 'campaign', 'notifications', 'notifications_active',
  'radio_button_unchecked', 'radio_button_checked',
  // Chrome
  'chevron_right', 'chevron_left', 'expand_more', 'expand_less',
  'arrow_back', 'arrow_forward', 'arrow_upward', 'arrow_downward', 'more_vert',
  // Domain
  'person', 'person_add', 'logout', 'lock', 'badge', 'phone', 'mail',
  'location_on', 'work', 'cake', 'handshake', 'description', 'request_quote',
  'assignment', 'calendar_today', 'calendar_month', 'star', 'help',
  // Groups and collection days
  'event_available', 'event_busy', 'today', 'group_add', 'checklist',
  'pending_actions', 'lock_open', 'percent',
  // Sign-in and brand chrome
  'login', 'verified_user',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/**
 * The Google Fonts URL for exactly those glyphs, at the weight/fill the Stitch
 * screens use (`'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24`).
 */
export const MATERIAL_SYMBOLS_HREF =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0' +
  `&icon_names=${[...ICON_NAMES].sort().join(',')}` +
  '&display=block';
