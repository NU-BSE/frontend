#include <algorithm>
#include <array>
#include <cctype>
#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <variant>
#include <vector>

namespace predictor {

constexpr std::size_t kFeatureCount = 10;
constexpr int kSchemaVersion = 1;
constexpr double kEwmaAlpha = 0.35;
constexpr std::array<double, 5> kRidgeGrid{{0.01, 0.1, 1.0, 10.0, 100.0}};
constexpr std::array<const char*, kFeatureCount> kFeatureNames{{
    "log_last_gap",
    "log_median_gap",
    "log_mean_gap",
    "log_ewma_gap",
    "log_recent3_median_gap",
    "log_iqr_gap",
    "gap_cv",
    "log_history_count",
    "log_elapsed_per_event",
    "log_last_to_median_ratio",
}};

using FeatureVector = std::array<double, kFeatureCount>;

// ------------------------------ Small JSON ------------------------------
// Standard-library-only JSON reader/writer sufficient for this model bundle.
class Json {
public:
    using Object = std::map<std::string, Json>;
    using Array = std::vector<Json>;
    using Value = std::variant<std::nullptr_t, bool, double, std::string, Array, Object>;

    Json() : value_(nullptr) {}
    Json(std::nullptr_t) : value_(nullptr) {}
    Json(bool v) : value_(v) {}
    Json(int v) : value_(static_cast<double>(v)) {}
    Json(std::size_t v) : value_(static_cast<double>(v)) {}
    Json(double v) : value_(v) {}
    Json(const char* v) : value_(std::string(v)) {}
    Json(std::string v) : value_(std::move(v)) {}
    Json(Array v) : value_(std::move(v)) {}
    Json(Object v) : value_(std::move(v)) {}

    bool is_object() const { return std::holds_alternative<Object>(value_); }
    bool is_array() const { return std::holds_alternative<Array>(value_); }
    bool is_string() const { return std::holds_alternative<std::string>(value_); }
    bool is_number() const { return std::holds_alternative<double>(value_); }
    bool is_bool() const { return std::holds_alternative<bool>(value_); }

    const Object& object() const { return std::get<Object>(value_); }
    Object& object() { return std::get<Object>(value_); }
    const Array& array() const { return std::get<Array>(value_); }
    const std::string& string() const { return std::get<std::string>(value_); }
    double number() const { return std::get<double>(value_); }
    bool boolean() const { return std::get<bool>(value_); }

    const Json& at(const std::string& key) const {
        const auto& o = object();
        auto it = o.find(key);
        if (it == o.end()) throw std::runtime_error("JSON key missing: " + key);
        return it->second;
    }

    const Json* find(const std::string& key) const {
        if (!is_object()) return nullptr;
        const auto& o = object();
        auto it = o.find(key);
        return it == o.end() ? nullptr : &it->second;
    }

    std::string dump(int indent = 2) const {
        std::ostringstream out;
        dump_impl(out, 0, indent);
        return out.str();
    }

    static Json parse(const std::string& text) {
        Parser p(text);
        Json v = p.parse_value();
        p.skip_ws();
        if (!p.eof()) throw std::runtime_error("Trailing characters after JSON document");
        return v;
    }

private:
    Value value_;

    static std::string escape(const std::string& s) {
        std::ostringstream o;
        for (unsigned char c : s) {
            switch (c) {
                case '"': o << "\\\""; break;
                case '\\': o << "\\\\"; break;
                case '\b': o << "\\b"; break;
                case '\f': o << "\\f"; break;
                case '\n': o << "\\n"; break;
                case '\r': o << "\\r"; break;
                case '\t': o << "\\t"; break;
                default:
                    if (c < 0x20) {
                        o << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                          << static_cast<int>(c) << std::dec << std::setfill(' ');
                    } else {
                        o << static_cast<char>(c);
                    }
            }
        }
        return o.str();
    }

    void dump_impl(std::ostream& out, int depth, int indent) const {
        if (std::holds_alternative<std::nullptr_t>(value_)) {
            out << "null";
        } else if (std::holds_alternative<bool>(value_)) {
            out << (boolean() ? "true" : "false");
        } else if (std::holds_alternative<double>(value_)) {
            double v = number();
            if (!std::isfinite(v)) throw std::runtime_error("Cannot serialize non-finite JSON number");
            out << std::setprecision(17) << v;
        } else if (std::holds_alternative<std::string>(value_)) {
            out << '"' << escape(string()) << '"';
        } else if (std::holds_alternative<Array>(value_)) {
            const auto& a = array();
            out << '[';
            if (!a.empty()) {
                for (std::size_t i = 0; i < a.size(); ++i) {
                    if (i) out << ',';
                    if (indent > 0) out << '\n' << std::string((depth + 1) * indent, ' ');
                    a[i].dump_impl(out, depth + 1, indent);
                }
                if (indent > 0) out << '\n' << std::string(depth * indent, ' ');
            }
            out << ']';
        } else {
            const auto& o = object();
            out << '{';
            std::size_t i = 0;
            for (const auto& [k, v] : o) {
                if (i++) out << ',';
                if (indent > 0) out << '\n' << std::string((depth + 1) * indent, ' ');
                out << '"' << escape(k) << "\":";
                if (indent > 0) out << ' ';
                v.dump_impl(out, depth + 1, indent);
            }
            if (!o.empty() && indent > 0) out << '\n' << std::string(depth * indent, ' ');
            out << '}';
        }
    }

    class Parser {
    public:
        explicit Parser(const std::string& s) : s_(s) {}
        bool eof() const { return pos_ >= s_.size(); }
        void skip_ws() {
            while (!eof() && std::isspace(static_cast<unsigned char>(s_[pos_]))) ++pos_;
        }

        Json parse_value() {
            skip_ws();
            if (eof()) throw std::runtime_error("Unexpected end of JSON");
            char c = s_[pos_];
            if (c == '{') return parse_object();
            if (c == '[') return parse_array();
            if (c == '"') return Json(parse_string());
            if (c == 't') { consume_literal("true"); return Json(true); }
            if (c == 'f') { consume_literal("false"); return Json(false); }
            if (c == 'n') { consume_literal("null"); return Json(nullptr); }
            if (c == '-' || std::isdigit(static_cast<unsigned char>(c))) return Json(parse_number());
            throw std::runtime_error(std::string("Invalid JSON value at position ") + std::to_string(pos_));
        }

    private:
        const std::string& s_;
        std::size_t pos_ = 0;

        void expect(char c) {
            skip_ws();
            if (eof() || s_[pos_] != c) {
                throw std::runtime_error(std::string("Expected '") + c + "' at JSON position " + std::to_string(pos_));
            }
            ++pos_;
        }

        void consume_literal(const char* lit) {
            for (const char* p = lit; *p; ++p) {
                if (eof() || s_[pos_] != *p) throw std::runtime_error("Invalid JSON literal");
                ++pos_;
            }
        }

        static int hexval(char c) {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return 10 + c - 'a';
            if (c >= 'A' && c <= 'F') return 10 + c - 'A';
            return -1;
        }

        static void append_utf8(std::string& out, unsigned code) {
            if (code <= 0x7F) out.push_back(static_cast<char>(code));
            else if (code <= 0x7FF) {
                out.push_back(static_cast<char>(0xC0 | (code >> 6)));
                out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
            } else {
                out.push_back(static_cast<char>(0xE0 | (code >> 12)));
                out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
                out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
            }
        }

        std::string parse_string() {
            expect('"');
            std::string out;
            while (!eof()) {
                char c = s_[pos_++];
                if (c == '"') return out;
                if (c != '\\') {
                    out.push_back(c);
                    continue;
                }
                if (eof()) throw std::runtime_error("Invalid JSON escape");
                char e = s_[pos_++];
                switch (e) {
                    case '"': out.push_back('"'); break;
                    case '\\': out.push_back('\\'); break;
                    case '/': out.push_back('/'); break;
                    case 'b': out.push_back('\b'); break;
                    case 'f': out.push_back('\f'); break;
                    case 'n': out.push_back('\n'); break;
                    case 'r': out.push_back('\r'); break;
                    case 't': out.push_back('\t'); break;
                    case 'u': {
                        unsigned code = 0;
                        for (int i = 0; i < 4; ++i) {
                            if (eof()) throw std::runtime_error("Short JSON unicode escape");
                            int h = hexval(s_[pos_++]);
                            if (h < 0) throw std::runtime_error("Invalid JSON unicode escape");
                            code = (code << 4) | static_cast<unsigned>(h);
                        }
                        append_utf8(out, code);
                        break;
                    }
                    default: throw std::runtime_error("Unsupported JSON escape");
                }
            }
            throw std::runtime_error("Unterminated JSON string");
        }

        double parse_number() {
            std::size_t start = pos_;
            if (s_[pos_] == '-') ++pos_;
            while (!eof() && std::isdigit(static_cast<unsigned char>(s_[pos_]))) ++pos_;
            if (!eof() && s_[pos_] == '.') {
                ++pos_;
                while (!eof() && std::isdigit(static_cast<unsigned char>(s_[pos_]))) ++pos_;
            }
            if (!eof() && (s_[pos_] == 'e' || s_[pos_] == 'E')) {
                ++pos_;
                if (!eof() && (s_[pos_] == '+' || s_[pos_] == '-')) ++pos_;
                while (!eof() && std::isdigit(static_cast<unsigned char>(s_[pos_]))) ++pos_;
            }
            char* end = nullptr;
            errno = 0;
            double v = std::strtod(s_.c_str() + start, &end);
            if (errno || end != s_.c_str() + pos_) throw std::runtime_error("Invalid JSON number");
            return v;
        }

        Json parse_array() {
            expect('[');
            Array a;
            skip_ws();
            if (!eof() && s_[pos_] == ']') { ++pos_; return Json(std::move(a)); }
            while (true) {
                a.push_back(parse_value());
                skip_ws();
                if (!eof() && s_[pos_] == ']') { ++pos_; break; }
                expect(',');
            }
            return Json(std::move(a));
        }

        Json parse_object() {
            expect('{');
            Object o;
            skip_ws();
            if (!eof() && s_[pos_] == '}') { ++pos_; return Json(std::move(o)); }
            while (true) {
                skip_ws();
                if (eof() || s_[pos_] != '"') throw std::runtime_error("Expected JSON object key");
                std::string key = parse_string();
                expect(':');
                o.emplace(std::move(key), parse_value());
                skip_ws();
                if (!eof() && s_[pos_] == '}') { ++pos_; break; }
                expect(',');
            }
            return Json(std::move(o));
        }
    };
};

static std::string read_text_file(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw std::runtime_error("Cannot open file: " + path);
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

static void write_text_file(const std::string& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary);
    if (!out) throw std::runtime_error("Cannot write file: " + path);
    out << text;
}

// ------------------------------ CSV ------------------------------
static std::vector<std::string> parse_csv_line(const std::string& line) {
    std::vector<std::string> out;
    std::string cell;
    bool quoted = false;
    for (std::size_t i = 0; i < line.size(); ++i) {
        char c = line[i];
        if (quoted) {
            if (c == '"') {
                if (i + 1 < line.size() && line[i + 1] == '"') {
                    cell.push_back('"');
                    ++i;
                } else {
                    quoted = false;
                }
            } else {
                cell.push_back(c);
            }
        } else {
            if (c == '"') quoted = true;
            else if (c == ',') { out.push_back(cell); cell.clear(); }
            else if (c != '\r') cell.push_back(c);
        }
    }
    out.push_back(cell);
    return out;
}

static std::string trim(std::string s) {
    auto not_space = [](unsigned char c) { return !std::isspace(c); };
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), not_space));
    s.erase(std::find_if(s.rbegin(), s.rend(), not_space).base(), s.end());
    return s;
}

static std::string lower_ascii(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

static std::string normalize_category(const std::string& raw) {
    std::string s = trim(raw);
    std::string out;
    bool underscore = false;
    for (unsigned char uc : s) {
        if (std::isalnum(uc)) {
            out.push_back(static_cast<char>(std::toupper(uc)));
            underscore = false;
        } else if (!out.empty() && !underscore) {
            out.push_back('_');
            underscore = true;
        }
    }
    while (!out.empty() && out.back() == '_') out.pop_back();
    return out;
}

static std::optional<std::size_t> find_header(const std::vector<std::string>& header,
                                              const std::vector<std::string>& names) {
    for (std::size_t i = 0; i < header.size(); ++i) {
        const auto h = lower_ascii(trim(header[i]));
        for (const auto& name : names) if (h == lower_ascii(name)) return i;
    }
    return std::nullopt;
}

static std::unordered_map<std::string, std::string> load_catalog(const std::string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("Cannot open catalog CSV: " + path);
    std::string line;
    if (!std::getline(in, line)) throw std::runtime_error("Catalog CSV is empty: " + path);
    auto header = parse_csv_line(line);
    auto app_col = find_header(header, {"app_id", "app_name", "package", "package_name"});
    auto cat_col = find_header(header, {"primary_category", "genre_id", "genreid", "category_id", "category", "category_en"});
    if (!app_col || !cat_col) {
        throw std::runtime_error(
            "Catalog must contain app_id/app_name/package and primary_category/genre_id/category_id/category"
        );
    }

    std::unordered_map<std::string, std::string> catalog;
    while (std::getline(in, line)) {
        auto row = parse_csv_line(line);
        if (row.size() <= std::max(*app_col, *cat_col)) continue;
        std::string app = trim(row[*app_col]);
        std::string cat = normalize_category(row[*cat_col]);
        if (!app.empty() && !cat.empty()) catalog.emplace(std::move(app), std::move(cat));
    }
    if (catalog.empty()) throw std::runtime_error("No usable app/category rows found in catalog");
    return catalog;
}

struct GroupKey {
    std::string user;
    std::string category;
    bool operator==(const GroupKey& other) const { return user == other.user && category == other.category; }
};

struct GroupKeyHash {
    std::size_t operator()(const GroupKey& k) const noexcept {
        std::size_t h1 = std::hash<std::string>{}(k.user);
        std::size_t h2 = std::hash<std::string>{}(k.category);
        return h1 ^ (h2 + 0x9e3779b97f4a7c15ULL + (h1 << 6) + (h1 >> 2));
    }
};

using Groups = std::unordered_map<GroupKey, std::vector<double>, GroupKeyHash>;

static bool parse_double(const std::string& s, double& out) {
    char* end = nullptr;
    errno = 0;
    out = std::strtod(s.c_str(), &end);
    return !errno && end != s.c_str() && *end == '\0' && std::isfinite(out);
}

static Groups load_grouped_events(const std::string& path,
                                  const std::unordered_map<std::string, std::string>& catalog,
                                  std::size_t& retained_rows) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("Cannot open interaction CSV: " + path);
    std::string line;
    if (!std::getline(in, line)) throw std::runtime_error("Interaction CSV is empty: " + path);
    auto first = parse_csv_line(line);
    std::vector<std::string> lower;
    for (auto x : first) lower.push_back(lower_ascii(trim(x)));

    auto user_col_h = find_header(first, {"user_id"});
    auto app_col_h = find_header(first, {"app_name", "app_id", "package", "package_name"});
    auto ts_col_h = find_header(first, {"timestamp"});
    bool has_header = user_col_h && app_col_h && ts_col_h;
    std::size_t user_col = has_header ? *user_col_h : 0;
    std::size_t app_col = has_header ? *app_col_h : 1;
    std::size_t ts_col = has_header ? *ts_col_h : 2;
    std::size_t max_col = std::max({user_col, app_col, ts_col});

    Groups groups;
    retained_rows = 0;
    auto consume = [&](const std::vector<std::string>& row) {
        if (row.size() <= max_col) return;
        std::string user = trim(row[user_col]);
        std::string app = trim(row[app_col]);
        std::string ts_raw = trim(row[ts_col]);
        if (user.empty() || app.empty() || ts_raw.empty()) return;
        auto cat_it = catalog.find(app);
        if (cat_it == catalog.end()) return;
        double t = 0.0;
        if (!parse_double(ts_raw, t)) return;
        groups[{std::move(user), cat_it->second}].push_back(t);
        ++retained_rows;
    };

    if (!has_header) consume(first);
    while (std::getline(in, line)) consume(parse_csv_line(line));
    return groups;
}

// ------------------------------ Features ------------------------------
static double quantile(std::vector<double> v, double q) {
    if (v.empty()) throw std::runtime_error("quantile of empty vector");
    std::sort(v.begin(), v.end());
    if (v.size() == 1) return v[0];
    double idx = q * static_cast<double>(v.size() - 1);
    std::size_t lo = static_cast<std::size_t>(std::floor(idx));
    std::size_t hi = static_cast<std::size_t>(std::ceil(idx));
    double w = idx - static_cast<double>(lo);
    return v[lo] * (1.0 - w) + v[hi] * w;
}

static double median(std::vector<double> v) { return quantile(std::move(v), 0.5); }

static FeatureVector history_features(const std::vector<double>& sorted_unique_times,
                                      std::size_t begin,
                                      std::size_t end_exclusive) {
    if (end_exclusive <= begin || end_exclusive - begin < 3)
        throw std::runtime_error("At least 3 category timestamps are required");

    std::vector<double> gaps;
    gaps.reserve(end_exclusive - begin - 1);
    for (std::size_t i = begin + 1; i < end_exclusive; ++i) {
        double g = sorted_unique_times[i] - sorted_unique_times[i - 1];
        if (g > 0.0) gaps.push_back(g);
    }
    if (gaps.size() < 2) throw std::runtime_error("At least 2 positive category gaps are required");

    double last = gaps.back();
    double med = median(gaps);
    double mean = 0.0;
    for (double g : gaps) mean += g;
    mean /= static_cast<double>(gaps.size());

    double ewma = gaps.front();
    for (std::size_t i = 1; i < gaps.size(); ++i) ewma = kEwmaAlpha * gaps[i] + (1.0 - kEwmaAlpha) * ewma;

    std::size_t r0 = gaps.size() > 3 ? gaps.size() - 3 : 0;
    std::vector<double> recent3(gaps.begin() + static_cast<std::ptrdiff_t>(r0), gaps.end());
    double recent3_med = median(recent3);
    double iqr = quantile(gaps, 0.75) - quantile(gaps, 0.25);

    double variance = 0.0;
    for (double g : gaps) variance += (g - mean) * (g - mean);
    variance /= static_cast<double>(gaps.size() - 1);
    double cv = std::min(10.0, std::sqrt(std::max(0.0, variance)) / std::max(mean, 1e-9));

    std::size_t hcount = end_exclusive - begin;
    double elapsed_per_event = (sorted_unique_times[end_exclusive - 1] - sorted_unique_times[begin]) /
                               static_cast<double>(std::max<std::size_t>(hcount - 1, 1));
    double last_to_median = last / std::max(med, 1e-9);

    return FeatureVector{{
        std::log1p(last),
        std::log1p(med),
        std::log1p(mean),
        std::log1p(ewma),
        std::log1p(recent3_med),
        std::log1p(iqr),
        cv,
        std::log1p(static_cast<double>(hcount)),
        std::log1p(std::max(elapsed_per_event, 0.0)),
        std::log(std::max(last_to_median, 1e-9)),
    }};
}

// ------------------------------ Offline regression ------------------------------
struct RegressionSums {
    std::size_t n = 0;
    std::array<double, kFeatureCount> sum_x{};
    std::array<double, kFeatureCount> sum_xy{};
    std::array<std::array<double, kFeatureCount>, kFeatureCount> sum_xx{};
    double sum_y = 0.0;

    void add(const FeatureVector& x, double y) {
        ++n;
        sum_y += y;
        for (std::size_t j = 0; j < kFeatureCount; ++j) {
            sum_x[j] += x[j];
            sum_xy[j] += x[j] * y;
            for (std::size_t k = 0; k < kFeatureCount; ++k) sum_xx[j][k] += x[j] * x[k];
        }
    }
};

struct ValidationSample {
    FeatureVector x{};
    double y = 0.0;
    double gap = 0.0;
};

struct SampleBucket {
    RegressionSums train;
    RegressionSums all;
    std::vector<ValidationSample> validation;
    std::vector<double> train_gaps;
    std::vector<double> all_gaps;
    std::size_t dataset_users = 0;
};

static std::uint64_t fnv1a64(const std::string& s) {
    std::uint64_t h = 1469598103934665603ULL;
    for (unsigned char c : s) {
        h ^= static_cast<std::uint64_t>(c);
        h *= 1099511628211ULL;
    }
    return h;
}

static bool is_validation_user(const std::string& user, int folds = 5) {
    return (fnv1a64(user) % static_cast<std::uint64_t>(folds)) == 0;
}

static std::vector<double> solve_linear(std::vector<std::vector<double>> a, std::vector<double> b) {
    const std::size_t n = b.size();
    for (std::size_t col = 0; col < n; ++col) {
        std::size_t pivot = col;
        double best = std::abs(a[col][col]);
        for (std::size_t row = col + 1; row < n; ++row) {
            double v = std::abs(a[row][col]);
            if (v > best) { best = v; pivot = row; }
        }
        if (best < 1e-12) throw std::runtime_error("Singular regression system");
        if (pivot != col) { std::swap(a[pivot], a[col]); std::swap(b[pivot], b[col]); }
        double diag = a[col][col];
        for (std::size_t j = col; j < n; ++j) a[col][j] /= diag;
        b[col] /= diag;
        for (std::size_t row = 0; row < n; ++row) {
            if (row == col) continue;
            double factor = a[row][col];
            if (factor == 0.0) continue;
            for (std::size_t j = col; j < n; ++j) a[row][j] -= factor * a[col][j];
            b[row] -= factor * b[col];
        }
    }
    return b;
}

struct FittedCoefficients {
    double intercept = 0.0;
    FeatureVector coef{};
};

static FittedCoefficients fit_ridge(const RegressionSums& s, double lambda) {
    if (s.n == 0) throw std::runtime_error("No regression samples");
    constexpr std::size_t p = kFeatureCount + 1;
    std::array<double, kFeatureCount> mu{};
    std::array<double, kFeatureCount> sigma{};
    for (std::size_t j = 0; j < kFeatureCount; ++j) {
        mu[j] = s.sum_x[j] / static_cast<double>(s.n);
        double var = s.sum_xx[j][j] / static_cast<double>(s.n) - mu[j] * mu[j];
        sigma[j] = std::sqrt(std::max(0.0, var));
        if (sigma[j] < 1e-9) sigma[j] = 1.0;
    }

    std::vector<std::vector<double>> normal(p, std::vector<double>(p, 0.0));
    std::vector<double> rhs(p, 0.0);
    normal[0][0] = static_cast<double>(s.n);
    rhs[0] = s.sum_y;

    for (std::size_t j = 0; j < kFeatureCount; ++j) {
        // Sum of standardized feature is numerically zero by construction.
        normal[0][j + 1] = normal[j + 1][0] = 0.0;
        rhs[j + 1] = (s.sum_xy[j] - mu[j] * s.sum_y) / sigma[j];
        for (std::size_t k = 0; k < kFeatureCount; ++k) {
            double centered = s.sum_xx[j][k] - static_cast<double>(s.n) * mu[j] * mu[k];
            normal[j + 1][k + 1] = centered / (sigma[j] * sigma[k]);
        }
        normal[j + 1][j + 1] += lambda;
    }

    auto beta = solve_linear(std::move(normal), std::move(rhs));
    FittedCoefficients out;
    out.intercept = beta[0];
    for (std::size_t j = 0; j < kFeatureCount; ++j) {
        out.coef[j] = beta[j + 1] / sigma[j];
        out.intercept -= beta[j + 1] * mu[j] / sigma[j];
    }
    return out;
}

static double predict_log_gap(const FittedCoefficients& model, const FeatureVector& x) {
    double y = model.intercept;
    for (std::size_t j = 0; j < kFeatureCount; ++j) y += model.coef[j] * x[j];
    return y;
}

static SampleBucket& category_bucket(std::map<std::string, SampleBucket>& buckets, const std::string& category) {
    return buckets[category];
}

static std::map<std::string, SampleBucket> build_training_samples(Groups& groups,
                                                                   int min_history,
                                                                   int max_history) {
    std::map<std::string, SampleBucket> buckets;
    buckets.emplace("__GLOBAL__", SampleBucket{});
    std::unordered_set<std::string> global_users;

    for (auto& [key, times] : groups) {
        std::sort(times.begin(), times.end());
        times.erase(std::unique(times.begin(), times.end()), times.end());
        if (times.size() < static_cast<std::size_t>(min_history + 1)) continue;

        bool val = is_validation_user(key.user);
        bool produced = false;
        auto& bucket = category_bucket(buckets, key.category);
        auto& global = buckets["__GLOBAL__"];

        for (std::size_t i = static_cast<std::size_t>(min_history); i < times.size(); ++i) {
            std::size_t begin = i > static_cast<std::size_t>(max_history) ? i - static_cast<std::size_t>(max_history) : 0;
            double next_gap = times[i] - times[i - 1];
            if (next_gap <= 0.0) continue;
            FeatureVector x;
            try { x = history_features(times, begin, i); }
            catch (...) { continue; }
            double y = std::log1p(next_gap);
            for (SampleBucket* target : {&bucket, &global}) {
                target->all.add(x, y);
                target->all_gaps.push_back(next_gap);
                if (val) target->validation.push_back({x, y, next_gap});
                else {
                    target->train.add(x, y);
                    target->train_gaps.push_back(next_gap);
                }
            }
            produced = true;
        }
        if (produced) {
            ++bucket.dataset_users;  // one group == one user/category
            global_users.insert(key.user);
        }
    }
    buckets["__GLOBAL__"].dataset_users = global_users.size();
    return buckets;
}

struct FrozenModel {
    std::string category;
    double intercept = 0.0;
    FeatureVector coefficients{};
    double ridge_lambda = 1.0;
    double clip_min = 1.0;
    double clip_max = 1.0;
    std::size_t training_samples = 0;
    std::size_t dataset_users = 0;
    std::optional<std::size_t> validation_samples;
    std::optional<double> validation_mae_seconds;
    std::optional<double> validation_median_ae_seconds;
    std::optional<double> validation_median_log_ae;
};

static std::optional<FrozenModel> fit_one_model(const SampleBucket& samples,
                                                 const std::string& category,
                                                 int min_samples) {
    if (samples.train.n < static_cast<std::size_t>(min_samples)) return std::nullopt;

    double best_lambda = 1.0;
    double best_score = std::numeric_limits<double>::infinity();
    FittedCoefficients best_holdout;

    if (!samples.validation.empty()) {
        for (double lambda : kRidgeGrid) {
            auto m = fit_ridge(samples.train, lambda);
            std::vector<double> errors;
            errors.reserve(samples.validation.size());
            for (const auto& v : samples.validation)
                errors.push_back(std::abs(predict_log_gap(m, v.x) - v.y));
            double score = median(errors);
            if (score < best_score) {
                best_score = score;
                best_lambda = lambda;
                best_holdout = m;
            }
        }
    } else {
        // Rare for a sufficiently large category; deterministic neutral fallback.
        best_lambda = 1.0;
        best_holdout = fit_ridge(samples.train, best_lambda);
    }

    FrozenModel out;
    out.category = category;
    out.ridge_lambda = best_lambda;
    out.training_samples = samples.all.n;
    out.dataset_users = samples.dataset_users;
    auto final_model = fit_ridge(samples.all, best_lambda);
    out.intercept = final_model.intercept;
    out.coefficients = final_model.coef;
    out.clip_min = std::max(1.0, quantile(samples.all_gaps, 0.01));
    out.clip_max = std::max(out.clip_min, quantile(samples.all_gaps, 0.99));

    if (!samples.validation.empty()) {
        double train_lo = std::max(1.0, quantile(samples.train_gaps, 0.01));
        double train_hi = std::max(train_lo, quantile(samples.train_gaps, 0.99));
        std::vector<double> abs_errors;
        std::vector<double> log_errors;
        abs_errors.reserve(samples.validation.size());
        log_errors.reserve(samples.validation.size());
        double sum_abs = 0.0;
        for (const auto& v : samples.validation) {
            double lp = predict_log_gap(best_holdout, v.x);
            double gap = std::expm1(std::clamp(lp, -20.0, 40.0));
            gap = std::clamp(gap, train_lo, train_hi);
            double ae = std::abs(gap - v.gap);
            sum_abs += ae;
            abs_errors.push_back(ae);
            log_errors.push_back(std::abs(lp - v.y));
        }
        out.validation_samples = samples.validation.size();
        out.validation_mae_seconds = sum_abs / static_cast<double>(samples.validation.size());
        out.validation_median_ae_seconds = median(abs_errors);
        out.validation_median_log_ae = median(log_errors);
    }
    return out;
}

static Json model_to_json(const FrozenModel& m) {
    Json::Object coeff;
    for (std::size_t i = 0; i < kFeatureCount; ++i) coeff[kFeatureNames[i]] = m.coefficients[i];
    Json::Object clip{{"min", m.clip_min}, {"max", m.clip_max}};
    Json::Object o{
        {"category", m.category},
        {"model", "ridge_on_log1p_next_gap"},
        {"intercept", m.intercept},
        {"coefficients", Json(std::move(coeff))},
        {"ridge_lambda", m.ridge_lambda},
        {"clip_gap_seconds", Json(std::move(clip))},
        {"training_samples", m.training_samples},
        {"dataset_users", m.dataset_users},
    };
    if (m.validation_samples) o["validation_samples"] = *m.validation_samples;
    if (m.validation_mae_seconds) o["validation_mae_seconds"] = *m.validation_mae_seconds;
    if (m.validation_median_ae_seconds) o["validation_median_ae_seconds"] = *m.validation_median_ae_seconds;
    if (m.validation_median_log_ae) o["validation_median_log_ae"] = *m.validation_median_log_ae;
    return Json(std::move(o));
}

static std::string iso_utc_now() {
    std::time_t now = std::time(nullptr);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &now);
#else
    gmtime_r(&now, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

static Json train_bundle(Groups& groups,
                         int min_history,
                         int max_history,
                         int min_category_samples) {
    auto buckets = build_training_samples(groups, min_history, max_history);
    auto global_model = fit_one_model(buckets.at("__GLOBAL__"), "__GLOBAL__", 10);
    if (!global_model) throw std::runtime_error("Not enough training sequences to fit global model");

    Json::Object categories;
    for (const auto& [category, bucket] : buckets) {
        if (category == "__GLOBAL__") continue;
        auto model = fit_one_model(bucket, category, min_category_samples);
        if (model) categories[category] = model_to_json(*model);
    }

    Json::Array feature_names;
    for (const char* name : kFeatureNames) feature_names.emplace_back(name);
    return Json(Json::Object{
        {"schema_version", kSchemaVersion},
        {"created_at_utc", iso_utc_now()},
        {"model_family", "cold_user_category_gap_regression"},
        {"prediction_target", "seconds_from_latest_category_event_to_next_category_event"},
        {"feature_names", Json(std::move(feature_names))},
        {"minimum_runtime_timestamps", min_history},
        {"maximum_history_events_used", max_history},
        {"validation_split", "deterministic_user_holdout_fnv1a64_mod_5"},
        {"important_semantics", "Coefficients are trained only from offline dataset users. Runtime timestamps are used only to calculate features; no fitting occurs during prediction."},
        {"global_model", model_to_json(*global_model)},
        {"category_models", Json(std::move(categories))},
    });
}

// ------------------------------ Runtime prediction ------------------------------
static FrozenModel model_from_json(const Json& j) {
    FrozenModel m;
    m.category = j.at("category").string();
    m.intercept = j.at("intercept").number();
    m.ridge_lambda = j.at("ridge_lambda").number();
    m.clip_min = j.at("clip_gap_seconds").at("min").number();
    m.clip_max = j.at("clip_gap_seconds").at("max").number();
    m.training_samples = static_cast<std::size_t>(j.at("training_samples").number());
    m.dataset_users = static_cast<std::size_t>(j.at("dataset_users").number());
    const auto& c = j.at("coefficients");
    for (std::size_t i = 0; i < kFeatureCount; ++i) m.coefficients[i] = c.at(kFeatureNames[i]).number();
    if (const Json* v = j.find("validation_median_ae_seconds")) m.validation_median_ae_seconds = v->number();
    return m;
}

// Howard Hinnant's civil-date conversion, adapted to return days since Unix epoch.
static long long days_from_civil(int y, unsigned m, unsigned d) {
    y -= m <= 2;
    const int era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return static_cast<long long>(era) * 146097LL + static_cast<long long>(doe) - 719468LL;
}

static bool parse_ndigits(const std::string& s, std::size_t pos, std::size_t n, int& value) {
    if (pos + n > s.size()) return false;
    int v = 0;
    for (std::size_t i = 0; i < n; ++i) {
        char c = s[pos + i];
        if (!std::isdigit(static_cast<unsigned char>(c))) return false;
        v = v * 10 + (c - '0');
    }
    value = v;
    return true;
}

static double parse_iso8601(const std::string& input) {
    std::string s = trim(input);
    if (s.size() < 19) throw std::runtime_error("ISO timestamp must include YYYY-MM-DDTHH:MM:SS");
    int Y, M, D, h, m, sec;
    if (!parse_ndigits(s, 0, 4, Y) || s[4] != '-' || !parse_ndigits(s, 5, 2, M) || s[7] != '-' ||
        !parse_ndigits(s, 8, 2, D) || (s[10] != 'T' && s[10] != ' ') ||
        !parse_ndigits(s, 11, 2, h) || s[13] != ':' || !parse_ndigits(s, 14, 2, m) || s[16] != ':' ||
        !parse_ndigits(s, 17, 2, sec)) {
        throw std::runtime_error("Invalid ISO-8601 timestamp: " + s);
    }
    if (M < 1 || M > 12 || D < 1 || D > 31 || h > 23 || m > 59 || sec > 60)
        throw std::runtime_error("Out-of-range ISO timestamp: " + s);

    std::size_t pos = 19;
    double frac = 0.0;
    if (pos < s.size() && s[pos] == '.') {
        ++pos;
        double scale = 0.1;
        while (pos < s.size() && std::isdigit(static_cast<unsigned char>(s[pos]))) {
            frac += (s[pos] - '0') * scale;
            scale *= 0.1;
            ++pos;
        }
    }

    int offset_seconds = 0; // Naive ISO is interpreted as UTC, matching the Python version.
    if (pos < s.size()) {
        if (s[pos] == 'Z' || s[pos] == 'z') {
            ++pos;
        } else if (s[pos] == '+' || s[pos] == '-') {
            int sign = s[pos] == '+' ? 1 : -1;
            ++pos;
            int oh = 0, om = 0;
            if (!parse_ndigits(s, pos, 2, oh)) throw std::runtime_error("Invalid ISO timezone offset");
            pos += 2;
            if (pos < s.size() && s[pos] == ':') ++pos;
            if (!parse_ndigits(s, pos, 2, om)) throw std::runtime_error("Invalid ISO timezone offset");
            pos += 2;
            offset_seconds = sign * (oh * 3600 + om * 60);
        } else {
            throw std::runtime_error("Unsupported ISO timestamp suffix: " + s.substr(pos));
        }
    }
    if (pos != s.size()) throw std::runtime_error("Trailing characters in ISO timestamp: " + s);

    long long days = days_from_civil(Y, static_cast<unsigned>(M), static_cast<unsigned>(D));
    return static_cast<double>(days * 86400LL + h * 3600 + m * 60 + sec - offset_seconds) + frac;
}

enum class TimestampMode { Relative, Absolute };

static std::pair<double, TimestampMode> parse_runtime_timestamp(const std::string& raw) {
    std::string s = trim(raw);
    double num = 0.0;
    if (parse_double(s, num)) return {num, std::abs(num) >= 1e9 ? TimestampMode::Absolute : TimestampMode::Relative};
    return {parse_iso8601(s), TimestampMode::Absolute};
}

static std::vector<std::string> read_timestamp_file(const std::string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("Cannot open timestamps file: " + path);
    std::vector<std::string> out;
    std::string line;
    while (std::getline(in, line)) {
        auto row = parse_csv_line(line);
        for (auto& cell : row) {
            cell = trim(cell);
            if (cell.empty()) continue;
            auto lower = lower_ascii(cell);
            if (lower == "timestamp" || lower == "timestamps" || lower == "event_time" || lower == "time") continue;
            out.push_back(cell);
            break;
        }
    }
    return out;
}

static std::pair<std::vector<double>, TimestampMode> parse_runtime_timestamps(const std::vector<std::string>& values) {
    std::vector<double> parsed;
    std::optional<TimestampMode> mode;
    for (const auto& raw_group : values) {
        std::stringstream ss(raw_group);
        std::string token;
        while (std::getline(ss, token, ',')) {
            token = trim(token);
            if (token.empty()) continue;
            auto [sec, m] = parse_runtime_timestamp(token);
            if (mode && *mode != m) throw std::runtime_error("Do not mix relative and absolute timestamps");
            mode = m;
            parsed.push_back(sec);
        }
    }
    if (parsed.size() < 3) throw std::runtime_error("At least 3 timestamps are required");
    std::sort(parsed.begin(), parsed.end());
    parsed.erase(std::unique(parsed.begin(), parsed.end()), parsed.end());
    if (parsed.size() < 3) throw std::runtime_error("At least 3 distinct timestamps are required");
    return {std::move(parsed), *mode};
}

static std::string format_utc_iso(double epoch_seconds) {
    std::time_t t = static_cast<std::time_t>(std::floor(epoch_seconds));
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[40];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

static std::optional<std::string> format_local_iso(double epoch_seconds, const std::string& timezone) {
#if defined(_WIN32)
    (void)epoch_seconds; (void)timezone;
    return std::nullopt;
#else
    const char* old_tz = std::getenv("TZ");
    std::optional<std::string> old = old_tz ? std::optional<std::string>(old_tz) : std::nullopt;
    if (setenv("TZ", timezone.c_str(), 1) != 0) return std::nullopt;
    tzset();
    std::time_t t = static_cast<std::time_t>(std::floor(epoch_seconds));
    std::tm tm{};
    localtime_r(&t, &tm);
    char datebuf[40];
    char offbuf[16];
    std::strftime(datebuf, sizeof(datebuf), "%Y-%m-%dT%H:%M:%S", &tm);
    std::strftime(offbuf, sizeof(offbuf), "%z", &tm);
    std::string offset = offbuf;
    if (offset.size() == 5) offset.insert(3, ":");
    std::string result = std::string(datebuf) + offset;
    if (old) setenv("TZ", old->c_str(), 1); else unsetenv("TZ");
    tzset();
    return result;
#endif
}

static Json predict(const Json& bundle,
                    const std::string& category_raw,
                    const std::vector<double>& timestamps,
                    TimestampMode mode,
                    const std::string& timezone) {
    std::string category = normalize_category(category_raw);
    const auto& models = bundle.at("category_models").object();
    auto it = models.find(category);
    bool fallback = it == models.end();
    FrozenModel model = model_from_json(fallback ? bundle.at("global_model") : it->second);

    int max_history = static_cast<int>(bundle.at("maximum_history_events_used").number());
    std::size_t begin = timestamps.size() > static_cast<std::size_t>(max_history)
                            ? timestamps.size() - static_cast<std::size_t>(max_history)
                            : 0;
    auto x = history_features(timestamps, begin, timestamps.size());
    double log_gap = predict_log_gap({model.intercept, model.coefficients}, x);
    double gap = std::expm1(std::clamp(log_gap, -20.0, 40.0));
    gap = std::clamp(gap, model.clip_min, model.clip_max);
    double last = timestamps.back();
    double predicted = last + gap;

    Json::Object features;
    for (std::size_t i = 0; i < kFeatureCount; ++i) features[kFeatureNames[i]] = x[i];
    Json::Object result{
        {"category_requested", category},
        {"model_category", model.category},
        {"used_global_fallback", fallback},
        {"runtime_event_count", timestamps.size()},
        {"runtime_events_used", timestamps.size() - begin},
        {"last_event_s", last},
        {"predicted_gap_seconds", gap},
        {"predicted_event_s", predicted},
        {"feature_vector", Json(std::move(features))},
        {"model_training_samples", model.training_samples},
        {"model_dataset_users", model.dataset_users},
        {"ridge_lambda", model.ridge_lambda},
    };
    if (model.validation_median_ae_seconds)
        result["offline_validation_median_ae_seconds"] = *model.validation_median_ae_seconds;
    if (mode == TimestampMode::Absolute) {
        result["predicted_at_utc"] = format_utc_iso(predicted);
        if (auto local = format_local_iso(predicted, timezone)) result["predicted_at_local"] = *local;
        result["timezone"] = timezone;
    }
    return Json(std::move(result));
}

// ------------------------------ CLI ------------------------------
class Args {
public:
    Args(int argc, char** argv) {
        for (int i = 1; i < argc; ++i) tokens_.emplace_back(argv[i]);
    }
    bool empty() const { return tokens_.empty(); }
    const std::string& command() const {
        if (tokens_.empty()) throw std::runtime_error("Missing command");
        return tokens_[0];
    }
    bool has(const std::string& key) const {
        return std::find(tokens_.begin() + std::min<std::size_t>(1, tokens_.size()), tokens_.end(), key) != tokens_.end();
    }
    std::optional<std::string> one(const std::string& key) const {
        for (std::size_t i = 1; i < tokens_.size(); ++i)
            if (tokens_[i] == key) {
                if (i + 1 >= tokens_.size()) throw std::runtime_error("Missing value after " + key);
                return tokens_[i + 1];
            }
        return std::nullopt;
    }
    std::vector<std::string> many(const std::string& key) const {
        std::vector<std::string> out;
        for (std::size_t i = 1; i < tokens_.size(); ++i)
            if (tokens_[i] == key) {
                if (i + 1 >= tokens_.size()) throw std::runtime_error("Missing value after " + key);
                out.push_back(tokens_[i + 1]);
            }
        return out;
    }
    std::string require(const std::string& key) const {
        auto v = one(key);
        if (!v) throw std::runtime_error("Required argument missing: " + key);
        return *v;
    }
    int integer(const std::string& key, int fallback) const {
        auto v = one(key);
        if (!v) return fallback;
        try { return std::stoi(*v); } catch (...) { throw std::runtime_error("Invalid integer for " + key); }
    }

private:
    std::vector<std::string> tokens_;
};

static void usage() {
    std::cerr << R"USAGE(
Cold-user category timestamp predictor (C++17)

Offline training:
  cold_start_category_predictor train \
    --input ./myket.csv \
    --catalog-csv ./app_catalog.csv \
    --output ./category_models.json

Cold-user prediction:
  cold_start_category_predictor predict \
    --model ./category_models.json \
    --category COMMUNICATION \
    --timestamp 1786900200 --timestamp 1786904100 --timestamp 1786911600

List trained categories:
  cold_start_category_predictor categories --model ./category_models.json

Options:
  train:   --min-history N (3) --max-history N (50) --min-category-samples N (100)
  predict: --timestamps-file FILE --timezone IANA_NAME (UTC)
)USAGE";
}

static int cmd_train(const Args& args) {
    std::string input = args.require("--input");
    std::string catalog_path = args.require("--catalog-csv");
    std::string output = args.one("--output").value_or("category_models.json");
    int min_history = args.integer("--min-history", 3);
    int max_history = args.integer("--max-history", 50);
    int min_category_samples = args.integer("--min-category-samples", 100);
    if (min_history < 3 || max_history < min_history || min_category_samples < 1)
        throw std::runtime_error("Invalid training limits");

    auto catalog = load_catalog(catalog_path);
    std::size_t retained = 0;
    auto groups = load_grouped_events(input, catalog, retained);
    std::cerr << "Offline rows=" << retained << " groups=" << groups.size()
              << " catalog_apps=" << catalog.size() << '\n';

    Json bundle = train_bundle(groups, min_history, max_history, min_category_samples);
    write_text_file(output, bundle.dump(2) + "\n");

    Json::Object summary{
        {"output", output},
        {"category_models", bundle.at("category_models").object().size()},
        {"global_training_samples", bundle.at("global_model").at("training_samples").number()},
    };
    std::cout << Json(std::move(summary)).dump(2) << '\n';
    return 0;
}

static int cmd_predict(const Args& args) {
    Json bundle = Json::parse(read_text_file(args.require("--model")));
    std::vector<std::string> raw = args.many("--timestamp");
    if (auto file = args.one("--timestamps-file")) {
        auto more = read_timestamp_file(*file);
        raw.insert(raw.end(), more.begin(), more.end());
    }
    auto [timestamps, mode] = parse_runtime_timestamps(raw);
    std::string timezone = args.one("--timezone").value_or("UTC");
    Json result = predict(bundle, args.require("--category"), timestamps, mode, timezone);
    std::cout << result.dump(2) << '\n';
    return 0;
}

static int cmd_categories(const Args& args) {
    Json bundle = Json::parse(read_text_file(args.require("--model")));
    for (const auto& [category, j] : bundle.at("category_models").object()) {
        std::cout << category << '\t'
                  << static_cast<std::size_t>(j.at("training_samples").number()) << '\t'
                  << static_cast<std::size_t>(j.at("dataset_users").number()) << '\n';
    }
    return 0;
}

} // namespace predictor

int main(int argc, char** argv) {
    try {
        predictor::Args args(argc, argv);
        if (args.empty()) { predictor::usage(); return 1; }
        if (args.command() == "--help" || args.command() == "-h" || args.has("--help") || args.has("-h")) {
            predictor::usage();
            return 0;
        }
        if (args.command() == "train") return predictor::cmd_train(args);
        if (args.command() == "predict") return predictor::cmd_predict(args);
        if (args.command() == "categories") return predictor::cmd_categories(args);
        predictor::usage();
        throw std::runtime_error("Unknown command: " + args.command());
    } catch (const std::exception& e) {
        std::cerr << "ERROR: " << e.what() << '\n';
        return 1;
    }
}
