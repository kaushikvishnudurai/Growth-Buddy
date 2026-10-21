package com.growthbuddy.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.DateTimeException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The Java mirror of {@code scripts/bank-msg.js}: one Indian bank or UPI message's
 * text in, the transaction it reports out, or null. It exists only because the
 * iPhone Shortcut posts the message to the server, which cannot run the phone's
 * JavaScript. Both are tested against {@code scripts/bank-msg.cases.json}
 * ({@code BankMessageParserTest}), so change a rule in both and add the case there.
 *
 * <p>Never logs or keeps the text.
 */
public final class BankMessageParser {

    public record Parsed(String kind, BigDecimal amount, String merchant, String last4, String ref,
                         LocalDate date, String channel, String confidence) {}

    private static final int CI = Pattern.CASE_INSENSITIVE;
    private static final BigDecimal MAX_AMOUNT = new BigDecimal("1000000000");

    private static final Pattern MONEY = Pattern.compile("(?:rs\\.?|inr|\u20b9)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)", CI);
    private static final Pattern VERB_AMOUNT = Pattern.compile(
            "\\b(?:debited|credited)\\s+(?:by|with|for)\\s+([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\b", CI);
    private static final Pattern BALANCE_BEFORE = Pattern.compile("(?:bal|balance|limit|lmt|avl\\.?|avail|available)\\W*$", CI);

    private static final Pattern OTP = Pattern.compile("\\b(?:otp|one[\\s-]?time\\s+password|verification\\s+code|passcode)\\b");
    private static final Pattern NOTICE = Pattern.compile(
            "\\bwill\\s+be\\s+(?:debited|deducted|charged)\\b|\\bis\\s+due\\b|\\bdue\\s+(?:on|date|by)\\b"
            + "|\\bminimum\\s+(?:amount\\s+)?due\\b|\\bpre-?approved\\b|\\bapply\\s+now\\b|\\beligible\\b"
            + "|\\bhas\\s+requested\\b|\\bcollect\\s+request\\b|\\brequested\\s+(?:rs|inr|money|\u20b9)");
    private static final Pattern FAILED = Pattern.compile(
            "\\b(?:failed|declined|unsuccessful|not\\s+successful|could\\s+not\\s+be\\s+(?:processed|completed))\\b");
    private static final Pattern REVERSAL = Pattern.compile("\\b(?:reversed|refunded|refund)\\b");
    private static final Pattern ATM = Pattern.compile("\\batm\\b");
    private static final Pattern ATM_CASH = Pattern.compile("\\b(?:withdrawn|withdrawal|cash)\\b");
    private static final Pattern CARD_BILL = Pattern.compile(
            "\\b(?:credit\\s+card|cc)\\s+(?:bill|payment|dues)\\b|\\bpayment\\b[^.]{0,60}\\breceived\\b[^.]{0,40}\\bcard\\b"
            + "|\\breceived\\b[^.]{0,30}\\btowards\\b[^.]{0,40}\\bcard\\b|\\btowards\\b[^.]{0,30}\\bcredit\\s+card\\b");
    private static final Pattern PAID_YOU = Pattern.compile("\\b(?:paid|sent)\\s+you\\b");
    private static final Pattern DEBIT = Pattern.compile("\\b(?:debited|debit|spent|sent|paid|withdrawn|deducted|dr|purchase|charged)\\b");
    private static final Pattern CREDIT = Pattern.compile("\\b(?:credited|credit|received|deposited|cr|refunded|refund|reversed)\\b");

    private static final List<Pattern> LAST4 = List.of(
            Pattern.compile("\\b(?:a/?c|acct|account|ac|card)\\b\\.?\\s*(?:no\\.?|number)?\\s*(?:ending\\s*(?:with|in)?)?"
                    + "\\s*[:-]?\\s*[x*]*\\s*([0-9]{3,6})\\b", CI),
            Pattern.compile("[\u2022*]{2,}\\s*([0-9]{3,4})\\b"));
    private static final List<Pattern> REF = List.of(
            Pattern.compile("\\b(?:upi\\s*ref(?:erence)?|ref(?:erence)?|rrn|utr|txn(?:\\s*(?:id|no\\.?))?|transaction\\s*id|imps\\s*ref)"
                    + "\\s*(?:no\\.?|number|#|id)?\\s*[:.-]?\\s*([0-9]{9,18})\\b", CI),
            Pattern.compile("\\bupi\\s*[:-]?\\s*([0-9]{9,18})\\b", CI),
            Pattern.compile("\\bupi/(?:[a-z0-9]+/)?([0-9]{9,18})/", CI));

    private static final String TERM =
            "(?=\\s*(?:\\.(?:\\s|$)|$|\\n|;|,|\\(|:)|[ ]+(?:on|ref|refno|rrn|utr|upi|avl|avail|available|bal|balance|total"
            + "|not|dt|date|via|using|if|info|for|is|has|was|thru|txn|and)\\b|[ ]+[0-9])";
    private static final String NAME = "([A-Za-z0-9][A-Za-z0-9&'.\\- ]{0,40}?)";
    private static final Pattern UPI_PATH = Pattern.compile(
            "\\bupi/(?:[a-z0-9]+/)?[0-9]{6,}/([A-Za-z0-9&'.\\- ]{2,40}?)(?=\\.(?:\\s|$)|$|\\n|/|;|,)", CI);
    private static final Pattern AT = Pattern.compile("(?:\\bat\\s+|(?<![A-Za-z0-9._-])@\\s*)" + NAME + TERM, CI);
    private static final Pattern TO = Pattern.compile("\\bto\\s+(?:vpa\\s+)?" + NAME + TERM, CI);
    private static final Pattern FROM = Pattern.compile("\\bfrom\\s+(?:vpa\\s+)?" + NAME + TERM, CI);
    private static final Pattern SEMI_CREDITED = Pattern.compile(";\\s*([A-Za-z0-9][A-Za-z0-9&'.\\- ]{1,40}?)\\s+credited\\b", CI);
    private static final Pattern TOWARDS = Pattern.compile("\\btowards\\s+(?!upi\\b)" + NAME + TERM, CI);
    private static final Pattern ON_CAPS = Pattern.compile("\\b(?:on|at)\\s+([A-Z][A-Z0-9&'.\\- ]{1,40}?)" + TERM);
    private static final Pattern VPA = Pattern.compile("\\b([a-z0-9][a-z0-9._-]{1,64})@([a-z][a-z0-9]{1,20})\\b", CI);
    private static final Pattern NOT_MERCHANT = Pattern.compile(
            "^(?:your|you|a/?c|ac|acct|account|the|card|vpa|upi|beneficiary|self|bank|mobile|date|dt)\\b|\\ba/?c\\b"
            + "|\\baccount\\b|\\bcard\\b|\\bbank\\s+a/?c\\b", CI);
    private static final Pattern JUNK_VPA = Pattern.compile("^(?:paytmqr|bharatpe|gpay-|mab\\.|upi|pay|q[0-9])", CI);
    private static final Pattern DATE_LINE = Pattern.compile(
            "^[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}(?:,?\\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?(?:\\s*[ap]m)?)?$", CI);
    private static final Pattern NEXT_LINE_NAME = Pattern.compile("^[A-Za-z][A-Za-z0-9&'.\\- ]{1,40}$");
    private static final Pattern NOT_NEXT_LINE = Pattern.compile("^(?:avl|avail|not|sms|bal|info|call)\\b", CI);
    private static final Pattern PHONE_OR_DIGITS = Pattern.compile("^[0-9]{4,}|^[0-9 ]+$");

    private static final Pattern ISO_DATE = Pattern.compile("\\b(20[0-9]{2})[-:/]([0-9]{2})[-:/]([0-9]{2})\\b");
    private static final Pattern DMY_DATE = Pattern.compile("\\b([0-9]{1,2})[-/]([0-9]{1,2})[-/]([0-9]{2,4})\\b");
    private static final Pattern DMONY_DATE = Pattern.compile("\\b([0-9]{1,2})[- ]?([A-Za-z]{3})[a-z]*[- ,]? ?([0-9]{2,4})\\b");
    private static final Map<String, Integer> MONTHS = Map.ofEntries(
            Map.entry("jan", 1), Map.entry("feb", 2), Map.entry("mar", 3), Map.entry("apr", 4), Map.entry("may", 5),
            Map.entry("jun", 6), Map.entry("jul", 7), Map.entry("aug", 8), Map.entry("sep", 9), Map.entry("oct", 10),
            Map.entry("nov", 11), Map.entry("dec", 12));

    private BankMessageParser() {
    }

    public static Parsed parse(String raw) {
        String text = clean(raw).replace("\u20b9", "Rs ");
        if (text.isEmpty() || text.length() > 2000) {
            return null;
        }
        String lower = text.toLowerCase(Locale.ROOT).replace('\n', ' ');
        if (OTP.matcher(lower).find() || NOTICE.matcher(lower).find() || CARD_BILL.matcher(lower).find()) {
            return null;
        }
        if (FAILED.matcher(lower).find() && !REVERSAL.matcher(lower).find()) {
            return null;
        }
        // ponytail: an ATM withdrawal moves money to cash, it is not spending (see bank-msg.js).
        if (ATM.matcher(lower).find() && ATM_CASH.matcher(lower).find()) {
            return null;
        }
        BigDecimal amount = findAmount(text);
        String kind = direction(lower);
        // Over 1,000,000,000 is no payment anyone was texted about (see bank-msg.js).
        if (amount == null || kind == null || amount.compareTo(MAX_AMOUNT) > 0) {
            return null;
        }
        String merchant = findMerchant(text, kind);
        String l4 = firstGroup(LAST4, text);
        String last4 = l4 == null ? null : l4.substring(Math.max(0, l4.length() - 4));
        String ref = firstGroup(REF, text);
        String confidence = merchant != null || last4 != null || ref != null ? "high" : "low";
        return new Parsed(kind, amount, merchant, last4, ref, findDate(text), findChannel(lower), confidence);
    }

    static String clean(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replaceAll("\\r\\n?", "\n").replaceAll("[ \\t\u00a0]+", " ").replaceAll(" ?\\n ?", "\n").strip();
    }

    private static BigDecimal readNumber(String s) {
        try {
            BigDecimal n = new BigDecimal(s.replace(",", "")).setScale(2, RoundingMode.HALF_UP);
            return n.signum() > 0 ? n : null;
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private static BigDecimal findAmount(String text) {
        Matcher m = MONEY.matcher(text);
        while (m.find()) {
            String before = text.substring(Math.max(0, m.start() - 20), m.start());
            if (BALANCE_BEFORE.matcher(before).find()) {
                continue;
            }
            BigDecimal n = readNumber(m.group(1));
            if (n != null) {
                return n;
            }
        }
        Matcher v = VERB_AMOUNT.matcher(text);
        return v.find() ? readNumber(v.group(1)) : null;
    }

    private static String direction(String lower) {
        if (PAID_YOU.matcher(lower).find()) {
            return "credit";
        }
        Matcher d = DEBIT.matcher(lower);
        Matcher c = CREDIT.matcher(lower.replaceAll("credit\\s+card", "card"));
        boolean hasD = d.find();
        boolean hasC = c.find();
        if (!hasD && !hasC) {
            return null;
        }
        if (!hasC) {
            return "debit";
        }
        if (!hasD) {
            return "credit";
        }
        return d.start() <= c.start() ? "debit" : "credit";
    }

    private static String firstGroup(List<Pattern> res, String text) {
        for (Pattern p : res) {
            Matcher m = p.matcher(text);
            if (m.find()) {
                return m.group(1);
            }
        }
        return null;
    }

    static String titleCase(String s) {
        if (!s.equals(s.toUpperCase(Locale.ROOT))) {
            return s;
        }
        StringBuilder out = new StringBuilder(s.length());
        boolean up = true;
        for (char ch : s.toLowerCase(Locale.ROOT).toCharArray()) {
            out.append(up && Character.isLetter(ch) ? Character.toUpperCase(ch) : ch);
            up = " .&'-".indexOf(ch) >= 0;
        }
        return out.toString();
    }

    private static String tidyName(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.replaceAll("\\s+", " ").replaceAll("[\\s.,:;-]+$", "").strip();
        if (s.length() < 2 || PHONE_OR_DIGITS.matcher(s).find() || NOT_MERCHANT.matcher(s).find()) {
            return null;
        }
        String t = titleCase(s);
        return t.length() > 40 ? t.substring(0, 40) : t;
    }

    /** {found, name}: found with a null name = a gateway or QR VPA, which names nobody. */
    private static String[] vpaName(String text) {
        Matcher m = VPA.matcher(text);
        if (!m.find()) {
            return new String[] {null, null};
        }
        String local = m.group(1);
        if (JUNK_VPA.matcher(local).find()) {
            return new String[] {"found", null};
        }
        StringBuilder name = new StringBuilder();
        for (String w : local.replaceAll("[0-9]+", " ").split("[._\\-\\s]+")) {
            if (w.isEmpty()) {
                continue;
            }
            if (name.length() > 0) {
                name.append(' ');
            }
            name.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1).toLowerCase(Locale.ROOT));
        }
        return new String[] {"found", name.length() >= 2 ? name.toString() : null};
    }

    private static String firstName(Pattern p, String text) {
        Matcher m = p.matcher(text);
        while (m.find()) {
            String name = tidyName(m.group(1));
            if (name != null) {
                return name;
            }
        }
        return null;
    }

    private static String lineAfterDate(String text) {
        String[] lines = text.split("\n");
        for (int i = 0; i < lines.length - 1; i++) {
            if (!DATE_LINE.matcher(lines[i]).find()) {
                continue;
            }
            String next = lines[i + 1];
            if (NEXT_LINE_NAME.matcher(next).find() && !NOT_NEXT_LINE.matcher(next).find()) {
                return tidyName(next);
            }
        }
        return null;
    }

    private static String findMerchant(String text, String kind) {
        Matcher path = UPI_PATH.matcher(text);
        if (path.find() && tidyName(path.group(1)) != null) {
            return tidyName(path.group(1));
        }
        String vpa = vpaName(text)[1];
        if (vpa != null) {
            return vpa;
        }
        List<Pattern> order = "credit".equals(kind) ? List.of(FROM, AT, TO) : List.of(AT, TO, TOWARDS);
        for (Pattern p : order) {
            String name = firstName(p, text);
            if (name != null) {
                return name;
            }
        }
        if ("debit".equals(kind)) {
            Matcher semi = SEMI_CREDITED.matcher(text);
            if (semi.find() && tidyName(semi.group(1)) != null) {
                return tidyName(semi.group(1));
            }
            String caps = firstName(ON_CAPS, text);
            if (caps != null) {
                return caps;
            }
        }
        return lineAfterDate(text);
    }

    private static LocalDate day(int y, int m, int d) {
        int year = y < 100 ? 2000 + y : y;
        if (year < 2000 || year > 2099) {
            return null;
        }
        try {
            return LocalDate.of(year, m, d);
        } catch (DateTimeException ex) {
            return null;
        }
    }

    private static LocalDate findDate(String text) {
        Matcher iso = ISO_DATE.matcher(text);
        if (iso.find()) {
            LocalDate v = day(Integer.parseInt(iso.group(1)), Integer.parseInt(iso.group(2)), Integer.parseInt(iso.group(3)));
            if (v != null) {
                return v;
            }
        }
        Matcher dmy = DMY_DATE.matcher(text);
        while (dmy.find()) {
            if (dmy.group(3).length() == 3) {
                continue;
            }
            LocalDate v = day(Integer.parseInt(dmy.group(3)), Integer.parseInt(dmy.group(2)), Integer.parseInt(dmy.group(1)));
            if (v != null) {
                return v;
            }
        }
        Matcher mon = DMONY_DATE.matcher(text);
        while (mon.find()) {
            Integer month = MONTHS.get(mon.group(2).toLowerCase(Locale.ROOT));
            if (month == null || mon.group(3).length() == 3) {
                continue;
            }
            LocalDate v = day(Integer.parseInt(mon.group(3)), month, Integer.parseInt(mon.group(1)));
            if (v != null) {
                return v;
            }
        }
        return null;
    }

    private static String findChannel(String lower) {
        if (Pattern.compile("\\b(?:e-?mandate|mandate|autopay|auto[- ]?debit|nach|ecs|standing\\s+instruction)\\b").matcher(lower).find()) {
            return "autodebit";
        }
        if (Pattern.compile("\\bupi\\b|\\bvpa\\b|[a-z0-9]@[a-z]{2,}").matcher(lower).find()) {
            return "upi";
        }
        for (String c : List.of("card", "neft", "imps", "rtgs")) {
            if (Pattern.compile("\\b" + c + "\\b").matcher(lower).find()) {
                return c;
            }
        }
        return null;
    }
}
