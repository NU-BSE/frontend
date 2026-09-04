/**
 * Presentation formatting for the phone number Telegram is sending a code to.
 *
 * TDLib hands back E.164 — `+77012345678` — which is correct and unreadable.
 * On the code screen it is the one piece of information that tells a user
 * whether they typed the right number, so it has to be scannable at a glance.
 *
 * Two deliberate limits. First, this only separates the calling code and
 * groups the rest; it is not libphonenumber and does not claim to know each
 * country's own convention. Grouping is what makes digits checkable, and a
 * wrong national format would be worse than a neutral one. Second, an input it
 * cannot parse is returned unchanged rather than mangled — a number shown
 * plainly is still useful, a number reformatted incorrectly is a reason to
 * cancel a login that was fine.
 */

/**
 * ITU-T E.164 calling codes, longest-prefix wins.
 *
 * Only the length matters here, so codes are grouped by it. Three-digit codes
 * are listed in full because the split is ambiguous without them: `+998…`
 * is Uzbekistan, but a naive one- or two-digit read would make it `+9` or
 * `+99`, neither of which exists.
 */
const CALLING_CODES: readonly string[] = [
  // 1-digit
  '1', '7',
  // 2-digit
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44',
  '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58',
  '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91',
  '92', '93', '94', '95', '98',
  // 3-digit
  '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226',
  '227', '228', '229', '230', '231', '232', '233', '234', '235', '236', '237',
  '238', '239', '240', '241', '242', '243', '244', '245', '246', '248', '249',
  '250', '251', '252', '253', '254', '255', '256', '257', '258', '260', '261',
  '262', '263', '264', '265', '266', '267', '268', '269', '290', '291', '297',
  '298', '299', '350', '351', '352', '353', '354', '355', '356', '357', '358',
  '359', '370', '371', '372', '373', '374', '375', '376', '377', '378', '380',
  '381', '382', '383', '385', '386', '387', '389', '420', '421', '423', '500',
  '501', '502', '503', '504', '505', '506', '507', '508', '509', '590', '591',
  '592', '593', '595', '597', '598', '599', '670', '672', '673', '674', '675',
  '676', '677', '678', '679', '680', '681', '682', '683', '685', '686', '687',
  '688', '689', '690', '691', '692', '850', '852', '853', '855', '856', '870',
  '880', '886', '960', '961', '962', '963', '964', '965', '966', '967', '968',
  '970', '971', '972', '973', '974', '975', '976', '977', '992', '993', '994',
  '995', '996', '998',
];

/** Longest calling code that prefixes these digits, or null. */
function splitCallingCode(digits: string): { code: string; national: string } | null {
  for (let length = 3; length >= 1; length -= 1) {
    const candidate = digits.slice(0, length);
    if (candidate.length === length && CALLING_CODES.includes(candidate)) {
      return { code: candidate, national: digits.slice(length) };
    }
  }
  return null;
}

/**
 * Groups a national number into readable runs.
 *
 * Threes from the left, which suits most of the world and is what Telegram's
 * own clients do for numbers they have no specific rule for. The tail is
 * merged into the previous group rather than left as a single orphan digit,
 * because `701 234 567 8` reads as a typo and `701 234 5678` does not.
 */
function groupNational(national: string): string {
  if (national.length <= 4) return national;

  const groups: string[] = [];
  for (let i = 0; i < national.length; i += 3) {
    groups.push(national.slice(i, i + 3));
  }

  const last = groups[groups.length - 1];
  if (groups.length > 1 && last !== undefined && last.length === 1) {
    groups.splice(-2, 2, `${groups[groups.length - 2]}${last}`);
  }
  return groups.join(' ');
}

/**
 * `+77012345678` → `+7 701 234 5678`.
 *
 * Returns the input untouched when it is not a number this can read: absent,
 * missing its `+`, carrying non-digits, or outside E.164's 7–15 digits.
 */
export function formatInternationalPhone(raw: string | undefined): string | null {
  if (!raw) return null;

  const cleaned = raw.replace(/[\s()\-–]/gu, '');
  if (!cleaned.startsWith('+')) return raw;

  const digits = cleaned.slice(1);
  if (!/^\d{7,15}$/u.test(digits)) return raw;

  const split = splitCallingCode(digits);
  if (!split) return `+${digits}`;

  const national = groupNational(split.national);
  return national.length > 0 ? `+${split.code} ${national}` : `+${split.code}`;
}
