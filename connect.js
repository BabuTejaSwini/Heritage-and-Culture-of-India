const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");  // Added for CORS support
const mysql = require("mysql2");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost', // e.g., '127.0.0.1'
    user: process.env.DB_USER || 'root',      // Your MySQL username
    password: process.env.DB_PASSWORD || 'TIGERR23', // Your MySQL password
    database: process.env.DB_NAME || 'heritage_db', // Your database name
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Use promise wrappers for async/await support
    // (This is why we use .promise() later)
}).promise(); 

// Test connection when the server starts
pool.getConnection()
    .then(connection => {
        console.log("✅ MySQL Pool connected successfully.");
        connection.release(); // Release the connection back to the pool
    })
    .catch(err => {
        console.error("❌ MySQL Connection Error:", err.message);
        // Do not crash the server, but log the error
    });
// ✅ Serve static files
app.use(cors());  // Enable CORS
app.use(express.static(path.join(__dirname, "public"))); // serve hist.html etc.

// ✅ Also serve data JSONs
app.use("/data", express.static(path.join(__dirname, "data")));

app.use(express.json()); 
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, password, display_name } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username & password required' });

    // check exists
    const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (rows.length) return res.status(409).json({ error: 'username_taken' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const [result] = await pool.query('INSERT INTO users (username, password_hash, display_name) VALUES (?,?,?)', [username, hash, display_name || null]);

    return res.json({ ok: true, user: { id: result.insertId, username, display_name } });
  } catch (err) {
    console.error('signup error', err);
    return res.status(500).json({ error: 'signup_failed' });
  }
});

// --- Auth: Login ---
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username & password required' });

    const [rows] = await pool.query('SELECT id, username, password_hash, display_name FROM users WHERE username = ?', [username]);
    if (!rows.length) return res.status(401).json({ error: 'invalid_credentials' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    // Minimal response for frontend: don't send password_hash
    return res.json({ ok: true, user: { id: user.id, username: user.username, display_name: user.display_name }});
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'login_failed' });
  }
});

// --- Submit a quiz score ---
app.post('/api/quiz/submit', async (req, res) => {
  try {
    const { user_id, score, quiz_name } = req.body;
    const quiz = quiz_name || 'default';
    if (!user_id || typeof score !== 'number') {
      return res.status(400).json({ error: 'user_id and numeric score required' });
    }

    // Check if user already has a score for this quiz
    const [existing] = await pool.query(
      'SELECT id, score FROM quiz_scores WHERE user_id = ? AND quiz_name = ?',
      [user_id, quiz]
    );

    if (existing.length > 0) {
      // Update only if new score is higher
      const oldScore = existing[0].score;
      if (score > oldScore) {
        await pool.query(
          'UPDATE quiz_scores SET score = ?, created_at = CURRENT_TIMESTAMP WHERE user_id = ? AND quiz_name = ?',
          [score, user_id, quiz]
        );
        return res.json({ ok: true, updated: true, new_score: score });
      } else {
        return res.json({ ok: true, updated: false, message: 'Lower score ignored' });
      }
    } else {
      // Insert new score if no previous record
      const [result] = await pool.query(
        'INSERT INTO quiz_scores (user_id, score, quiz_name) VALUES (?,?,?)',
        [user_id, score, quiz]
      );
      return res.json({ ok: true, inserted: true, id: result.insertId });
    }
  } catch (err) {
    console.error('submit score error', err);
    return res.status(500).json({ error: 'submit_failed' });
  }
});


// --- Leaderboard: top N scores for a quiz ---
app.get('/api/quiz/leaderboard', async (req, res) => {
  try {
    const quiz_name = req.query.quiz_name || 'default';
    const limit = Math.min(parseInt(req.query.limit || '10', 10), 100);

    const [rows] = await pool.query(
      `SELECT q.id, q.user_id, q.score, q.created_at, u.username, u.display_name
       FROM quiz_scores q
       JOIN users u ON u.id = q.user_id
       WHERE q.quiz_name = ?
       ORDER BY q.score DESC, q.created_at ASC
       LIMIT ?`,
      [quiz_name, limit]
    );

    return res.json({ ok: true, leaderboard: rows });
  } catch (err) {
    console.error('leaderboard error', err);
    return res.status(500).json({ error: 'leaderboard_failed' });
  }
});

// ✅ Folktales API
app.get("/api/folktales", (req, res) => {
  const filePath = path.join(__dirname, "public", "FolkTales.json");
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading FolkTales.json:", err);
      return res.status(500).json({ error: "Could not load FolkTales.json" });
    }
    try {
      const stories = JSON.parse(data);
      res.json({ folktales: stories }); //  wrap array
    } catch (e) {
      res.status(500).json({ error: "Invalid JSON format" });
    }
  });
});
app.get("/api/arts", (req, res) => {
  const filePath = path.join(__dirname, "public", "arts.json");
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading arts.json:", err);
      return res.status(500).json({ error: "Could not load arts data" });
    }
    try {
      const jsonData = JSON.parse(data);
      res.json(jsonData);
    } catch (parseErr) {
      console.error("Invalid JSON in arts.json:", parseErr);
      res.status(500).json({ error: "Invalid JSON structure" });
    }
  });
});

// Utility: normalize date strings to 'YYYY-MM-DD' (local)
function ensureISODate(thing, defaultYear = null) {
  if (!thing) return null;

  // If already ISO-like
  if (typeof thing === 'string') {
    const isoMatch = thing.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) return thing;

    const mmdd = thing.match(/^(\d{2})-(\d{2})$/);
    if (mmdd && defaultYear) {
      return `${defaultYear}-${mmdd[1]}-${mmdd[2]}`;
    }

    // fallback: try Date parsing and build ISO local date
    const d = new Date(thing);
    if (!isNaN(d)) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    return null;
  }

  if (typeof thing === 'object') {
    const y = thing.year || defaultYear;
    let m = thing.month;
    // month might be 1-12 or 0-11
    if (m !== undefined && m !== null) {
      if (m >= 1 && m <= 12) m = m - 1;
      // make sure integer
      m = Number(m);
      const day = Number(thing.day || thing.date || 1);
      if (y && !isNaN(m) && !isNaN(day)) {
        const dt = new Date(y, m, day);
        const yyyy = dt.getFullYear();
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    }
  }

  return null;
}

function flattenIndiaCommon(data) {
  const out = [];
  if (!data || typeof data !== 'object') return out;

  // Helper to push event
  function pushEvent(name, isoDate, meta = {}) {
    if (!isoDate) return;
    out.push({
      name: name || meta.name || 'Event',
      date: isoDate,
      type: meta.type || meta.isHoliday || meta.group === 'non_holidays' ? 'holiday' : (meta.type || 'festival'),
      overview: meta.overview || meta.description || '',
      color: meta.color || (meta.type === 'holiday' ? '#18b93f' : '#ff8a5b'),
      source: meta.source || 'india_common'
    });
  }

  // 1) fixed_holidays (holidays and non_holidays)
  if (data.fixed_holidays) {
    ['holidays', 'non_holidays'].forEach(group => {
      const arr = data.fixed_holidays[group];
      if (Array.isArray(arr)) {
        arr.forEach(item => {
          if (!item) return;
          // item may have .date as 'YYYY-MM-DD' or 'MM-DD' or object with day/month/year
          let iso = null;
          // prefer full date strings
          if (typeof item.date === 'string') {
            // if date lacks year, try to expand for a range of years? — here choose to keep year if provided, otherwise skip
            iso = ensureISODate(item.date);
          } else if (item.year && (item.month !== undefined) && item.day) {
            iso = ensureISODate({ year: item.year, month: item.month, day: item.day });
          }
          // If item has recurring month-day (like "01-26") but no year, include it for upcoming + a few years?
          // For simplicity we'll not expand recurring to multiple years here; frontend can filter by current year.
          pushEvent(item.name, iso, { ...item, group });
        });
      }
    });
  }

  // 2) movable_festivals - usually with f.dates array
  if (Array.isArray(data.movable_festivals)) {
    data.movable_festivals.forEach(f => {
      if (!f) return;
      // each f.dates entry can have .date or {year, date} or {year, month, day}
      if (Array.isArray(f.dates)) {
        f.dates.forEach(d => {
          if (!d) return;
          let iso = null;
          if (typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
            iso = d.date;
          } else if (d.year && typeof d.date === 'string' && /^\d{2}-\d{2}$/.test(d.date)) {
            // date = 'MM-DD'
            iso = `${d.year}-${d.date}`;
          } else if (d.year && (d.month !== undefined) && d.day) {
            iso = ensureISODate({ year: d.year, month: d.month, day: d.day });
          } else if (typeof d.date === 'string') {
            iso = ensureISODate(d.date, d.year || null);
          }
          pushEvent(f.name, iso, { ...f, ...d });
        });
      } else if (typeof f.date === 'string') {
        const iso = ensureISODate(f.date);
        pushEvent(f.name, iso, f);
      }
    });
  }

  // Optionally: deduplicate by name+date
  const seen = new Set();
  const filtered = [];
  out.forEach(e => {
    const key = `${e.name}::${e.date}`;
    if (!seen.has(key) && e.date) {
      seen.add(key);
      filtered.push(e);
    }
  });

  // sort by date asc
  filtered.sort((a, b) => (a.date > b.date ? 1 : -1));
  return filtered;
}

// API for common festivals only (from india_common.json)
app.get('/api/festivals', (req, res) => {
  try {
    const dataPath = path.join(__dirname, 'public', 'india_common.json');
    const raw = fs.readFileSync(dataPath, 'utf8');
    const json = JSON.parse(raw);
    const events = flattenIndiaCommon(json); // Converts to usable format
    res.json({ festivals: events });
  } catch (err) {
    console.error('Error loading india_common.json:', err);
    res.status(500).json({ error: 'Could not load india_common.json' });
  }
});


// Constants for places API (from connect1.js)
const DUCKDUCKGO_INSTANT = "https://api.duckduckgo.com/";
const UNSPLASH_SEARCH = "https://api.unsplash.com/search/photos";
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || ""; 
const FORWARD_HEADERS = {
  "User-Agent": "MyHeritageSite/1.0 (contact@example.com)",
  "Accept": "application/json"
};

// // Helper: fetch wrapper with error handling (converted to CommonJS)
async function safeFetch(url, options = {}) {
  const res = await fetch(url, { headers: { ...FORWARD_HEADERS, ...(options.headers || {}) } });
  const text = await res.text();
  if (!res.ok) {
    const e = new Error(`Upstream request failed with ${res.status}`);
    e.status = res.status;
    e.body = text;
    throw e;
  }
  try { return JSON.parse(text); } catch { return text; }
}

// Text search/summary using DuckDuckGo Instant Answer
app.get("/api/places/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "missing q" });

    const url = `${DUCKDUCKGO_INSTANT}?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const data = await safeFetch(url);

    // Normalize into a small predictable shape
    const result = {
      query: q,
      title: data.Heading || q,
      abstract: data.Abstract || data.AbstractText || "",
      abstractSource: data.AbstractSource || data.RelatedTopics?.[0]?.FirstURL || "",
      url: data.AbstractURL || data.RelatedTopics?.[0]?.FirstURL || "",
      related: []
    };

    // RelatedTopics can be an array of sections or topics; flatten useful ones
    if (Array.isArray(data.RelatedTopics)) {
      for (const t of data.RelatedTopics) {
        if (t.Text && t.FirstURL) {
          result.related.push({ text: t.Text, url: t.FirstURL });
        } else if (t.Topics && Array.isArray(t.Topics)) {
          for (const sub of t.Topics) {
            if (sub.Text && sub.FirstURL) result.related.push({ text: sub.Text, url: sub.FirstURL });
          }
        }
        if (result.related.length >= 8) break;
      }
    }

    res.json(result);
  } catch (err) {
    console.error("search error:", err);
    res.status(err.status || 500).json({ error: err.message, details: err.body || null });
  }
});

// Places info endpoint
app.get("/api/places/info", async (req, res) => {
  try {
    const title = (req.query.title || "").trim();
    if (!title) return res.status(400).json({ error: "missing title" });
    const url = `${DUCKDUCKGO_INSTANT}?q=${encodeURIComponent(title)}&format=json&no_html=1&skip_disambig=0`;
    const data = await safeFetch(url);
    const leadText = data.Abstract || data.AbstractText || "No summary available.";
    const sections = [];
    if (Array.isArray(data.RelatedTopics)) {
      for (const t of data.RelatedTopics.slice(0, 10)) {  // Limit to 10 for performance
        if (t.Text) {
          sections.push({ line: t.Text.split(' - ')[0] || 'Related', text: t.Text });
        }
      }
    }
    const result = {
      lead: { sections: [{ text: leadText }] },  // Client expects lead.sections[0].text
      sections: sections  // Client loops over sections
    };
    res.json(result);
  } catch (err) {
    console.error("info error:", err);
    res.status(err.status || 500).json({ error: err.message, details: err.body || null });
  }
});

// Places media endpoint (added from earlier fixes)
app.get("/api/places/media", async (req, res) => {
  try {
    const title = (req.query.title || "").trim();
    if (!title) return res.status(400).json({ error: "missing title" });

    const per_page = 6;  // Limit images for performance
    let imgs = [];

    if (UNSPLASH_ACCESS_KEY) {
      const u = `${UNSPLASH_SEARCH}?query=${encodeURIComponent(title)}&per_page=${per_page}&orientation=landscape`;
      const data = await safeFetch(u, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } });
      imgs = (data.results || []).map(p => ({
        src: p.urls?.regular || p.urls?.small,
        alt: p.alt_description || title
      }));
    } else {
      // Fallback to Source Unsplash
      for (let i = 0; i < per_page; i++) {
        imgs.push({
          src: `https://source.unsplash.com/collection/190727/400x300?${encodeURIComponent(title)}`,
          alt: title
        });
      }
    }

    // Return as array to match client's expectation
    res.json(imgs);
  } catch (err) {
    console.error("media error:", err);
    res.status(500).json([]);  // Return empty array on error
  }
});



// Simple health endpoint
app.get("/api/health", (_, res) => res.json({ ok: true, ts: Date.now() }));

// ✅ Serve main HTML page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "FinalProject.html"));
});
app.get("/quiz", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "quiz.html"));
});
app.listen(PORT, () => {
  console.log(`✅ Proxy server running on http://localhost:${PORT}`);
  if (!UNSPLASH_ACCESS_KEY) {
    console.log("No UNSPLASH_ACCESS_KEY set — using source.unsplash.com fallback for images.");
  }
});

/* ============================================================
   CLEAN & OPTIMIZED SERVER — HERITAGE PROJECT
   ============================================================ */

// const express = require("express");
// const path = require("path");
// const fs = require("fs");
// const cors = require("cors");
// const bcrypt = require("bcrypt");
// const mysql = require("mysql2");
// const app = express();

// /* ============================================================
//    CONFIG
//    ============================================================ */

// const PORT = process.env.PORT || 3000;

// const pool = mysql.createPool({
//   host: process.env.DB_HOST || "localhost",
//   user: process.env.DB_USER || "root",
//   password: process.env.DB_PASSWORD || "TIGERR23",
//   database: process.env.DB_NAME || "heritage_db",
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0
// }).promise();

// // Test DB connection
// pool.getConnection()
//   .then(c => {
//     console.log("✅ MySQL connected");
//     c.release();
//   })
//   .catch(err => console.error("❌ MySQL Error:", err.message));

// /* ============================================================
//    MIDDLEWARE
//    ============================================================ */

// app.use(cors());
// app.use(express.json());
// app.use(express.static(path.join(__dirname, "public")));
// app.use("/data", express.static(path.join(__dirname, "data")));

// /* ============================================================
//    HELPERS
//    ============================================================ */

// // Universal safe fetch
// async function safeFetch(url, options = {}) {
//   const res = await fetch(url, options);
//   const text = await res.text();

//   if (!res.ok) {
//     const e = new Error(`Upstream ${res.status}`);
//     e.body = text;
//     throw e;
//   }
//   try { return JSON.parse(text); } catch { return text; }
// }

// /* ============================================================
//    AUTH ROUTES (Signup / Login)
//    ============================================================ */

// const SALT_ROUNDS = 10;

// // Signup
// app.post("/api/auth/signup", async (req, res) => {
//   try {
//     const { username, password, display_name } = req.body;
//     if (!username || !password)
//       return res.status(400).json({ error: "username & password required" });

//     const [exists] = await pool.query("SELECT id FROM users WHERE username = ?", [username]);
//     if (exists.length) return res.status(409).json({ error: "username_taken" });

//     const hash = await bcrypt.hash(password, SALT_ROUNDS);
//     const [result] = await pool.query(
//       "INSERT INTO users (username, password_hash, display_name) VALUES (?,?,?)",
//       [username, hash, display_name || null]
//     );

//     res.json({ ok: true, user: { id: result.insertId, username, display_name }});
//   } catch (err) {
//     console.error("Signup error:", err);
//     res.status(500).json({ error: "signup_failed" });
//   }
// });

// // Login
// app.post("/api/auth/login", async (req, res) => {
//   try {
//     const { username, password } = req.body;
//     if (!username || !password)
//       return res.status(400).json({ error: "username & password required" });

//     const [rows] = await pool.query(
//       "SELECT id, username, password_hash, display_name FROM users WHERE username = ?",
//       [username]
//     );
//     if (!rows.length) return res.status(401).json({ error: "invalid_credentials" });

//     const user = rows[0];
//     const ok = await bcrypt.compare(password, user.password_hash);
//     if (!ok) return res.status(401).json({ error: "invalid_credentials" });

//     res.json({ ok: true, user: { id: user.id, username, display_name: user.display_name }});
//   } catch (err) {
//     console.error("Login error:", err);
//     res.status(500).json({ error: "login_failed" });
//   }
// });

// /* ============================================================
//    QUIZ ROUTES
//    ============================================================ */

// // Submit score
// app.post("/api/quiz/submit", async (req, res) => {
//   try {
//     const { user_id, score, quiz_name } = req.body;
//     if (!user_id || typeof score !== "number")
//       return res.status(400).json({ error: "Bad data" });

//     const quiz = quiz_name || "default";

//     const [exists] = await pool.query(
//       "SELECT id, score FROM quiz_scores WHERE user_id = ? AND quiz_name = ?",
//       [user_id, quiz]
//     );

//     if (exists.length) {
//       const oldScore = exists[0].score;
//       if (score > oldScore) {
//         await pool.query(
//           "UPDATE quiz_scores SET score = ?, created_at = CURRENT_TIMESTAMP WHERE user_id = ? AND quiz_name = ?",
//           [score, user_id, quiz]
//         );
//         return res.json({ ok: true, updated: true });
//       }
//       return res.json({ ok: true, updated: false });
//     }

//     const [insert] = await pool.query(
//       "INSERT INTO quiz_scores (user_id, score, quiz_name) VALUES (?,?,?)",
//       [user_id, score, quiz]
//     );
//     res.json({ ok: true, inserted: true, id: insert.insertId });
//   } catch (err) {
//     console.error("Score error:", err);
//     res.status(500).json({ error: "submit_failed" });
//   }
// });

// // Leaderboard
// app.get("/api/quiz/leaderboard", async (req, res) => {
//   try {
//     const quiz_name = req.query.quiz_name || "default";
//     const [rows] = await pool.query(
//       `SELECT q.id, q.user_id, q.score, q.created_at, u.username, u.display_name
//        FROM quiz_scores q
//        JOIN users u ON u.id = q.user_id
//        WHERE q.quiz_name = ?
//        ORDER BY q.score DESC, q.created_at ASC
//        LIMIT 10`,
//       [quiz_name]
//     );
//     res.json({ ok: true, leaderboard: rows });
//   } catch (err) {
//     console.error("Leaderboard error:", err);
//     res.status(500).json({ error: "leaderboard_failed" });
//   }
// });

// /* ============================================================
//    JSON FILE ROUTES (Folktales / Arts)
//    ============================================================ */

// // Folktales
// app.get("/api/folktales", (req, res) => {
//   const filePath = path.join(__dirname, "public", "FolkTales.json");
//   fs.readFile(filePath, "utf8", (err, data) => {
//     if (err) return res.status(500).json({ error: "Could not load folktales" });
//     try { res.json({ folktales: JSON.parse(data) }); }
//     catch { res.status(500).json({ error: "Invalid folktales JSON" }); }
//   });
// });

// // Arts
// app.get("/api/arts", (req, res) => {
//   const filePath = path.join(__dirname, "public", "arts.json");
//   fs.readFile(filePath, "utf8", (err, data) => {
//     if (err) return res.status(500).json({ error: "Could not load arts" });
//     try { res.json(JSON.parse(data)); }
//     catch { res.status(500).json({ error: "Invalid arts JSON" }); }
//   });
// });

// /* ============================================================
//    FESTIVALS API
//    ============================================================ */

// function ensureISODate(dateStr) {
//   const d = new Date(dateStr);
//   if (isNaN(d)) return null;
//   return d.toISOString().split("T")[0];
// }

// function flattenIndiaCommon(json) {
//   const out = [];

//   function push(item) {
//     if (item.date) {
//       const iso = ensureISODate(item.date);
//       if (iso) out.push({ ...item, date: iso });
//     }
//   }

//   if (json.fixed_holidays) {
//     Object.values(json.fixed_holidays).forEach(arr => arr.forEach(push));
//   }

//   if (json.movable_festivals) {
//     json.movable_festivals.forEach(f => {
//       if (f.dates) f.dates.forEach(d => push({ name: f.name, ...d }));
//     });
//   }

//   return out.sort((a, b) => a.date.localeCompare(b.date));
// }

// app.get("/api/festivals", (req, res) => {
//   try {
//     const file = path.join(__dirname, "data", "india_common.json");
//     const raw = fs.readFileSync(file, "utf8");
//     const json = JSON.parse(raw);
//     res.json({ festivals: flattenIndiaCommon(json) });
//   } catch (err) {
//     console.error("Festivals error:", err);
//     res.status(500).json({ error: "festival_load_failed" });
//   }
// });

// /* ============================================================
//    WIKIPEDIA HISTORICAL PLACES
//    ============================================================ */

// // Summary
// app.get("/api/places/search", async (req, res) => {
//   try {
//     const q = req.query.q?.trim();
//     if (!q) return res.status(400).json({ error: "missing q" });

//     const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`;
//     const data = await safeFetch(url);

//     res.json({
//       title: data.title,
//       description: data.description,
//       extract: data.extract,
//       thumbnail: data.thumbnail?.source || "",
//       url: data.content_urls?.desktop?.page || ""
//     });
//   } catch (err) {
//     console.error("Wiki search error:", err);
//     res.status(500).json({ error: "wiki_summary_failed" });
//   }
// });

// // Full article sections
// app.get("/api/places/info", async (req, res) => {
//   try {
//     const title = req.query.title?.trim();
//     if (!title) return res.status(400).json({ error: "missing title" });

//     const url = `https://en.wikipedia.org/api/rest_v1/page/mobile-sections/${encodeURIComponent(title)}`;
//     const data = await safeFetch(url);

//     res.json({
//       lead: data.lead?.sections || [],
//       sections: data.remaining?.sections || []
//     });
//   } catch (err) {
//     console.error("Wiki info error:", err);
//     res.status(500).json({ error: "wiki_info_failed" });
//   }
// });

// /* ============================================================
//    MAIN PAGES
//    ============================================================ */

// app.get("/", (_, res) =>
//   res.sendFile(path.join(__dirname, "public", "FinalProject.html"))
// );

// app.get("/quiz", (_, res) =>
//   res.sendFile(path.join(__dirname, "public", "quiz.html"))
// );

// /* ============================================================
//    START SERVER
//    ============================================================ */

// app.listen(PORT, () => {
//   console.log(`🚀 Server running at http://localhost:${PORT}`);
// });
