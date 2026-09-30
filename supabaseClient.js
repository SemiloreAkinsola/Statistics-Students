// ===== SUPABASE SETUP =====
const SUPABASE_URL = 'https://ixwoaefcptydjpknhybx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4d29hZWZjcHR5ZGpwa25oeWJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzQ3ODYsImV4cCI6MjEwNDcxMDc4Nn0.EG6C9hpHz57rIxIjldbPgjs1fxNRT-vXbcawKWS7Tkc';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== HELPERS =====
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const fmt = d => d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '';

// ===== TYPEWRITER (login page) =====
function typeWriter(text, elementId, speed = 38, startDelay = 600) {
  const el = document.getElementById(elementId);
  if (!el) return;
  let i = 0;
  el.innerHTML = '<span class="cursor"></span>';

  setTimeout(() => {
    const interval = setInterval(() => {
      if (i < text.length) {
        el.innerHTML = text.slice(0, i + 1) + '<span class="cursor"></span>';
        i++;
      } else {
        clearInterval(interval);
        const c = el.querySelector('.cursor');
        if (c) c.remove();
      }
    }, speed);
  }, startDelay);
}

typeWriter('Daily updates, notes, and a study guide — built for you.', 'typewriter-text');

// ===== MATRIC LOGIN =====
const APP_DOMAIN = 'sta122.app';
const matricKey = m => m.toLowerCase().replace(/[^a-z0-9]/g, '');
const matricEmail = m => matricKey(m) + '@' + APP_DOMAIN;
const matricPass = m => matricKey(m) + '#sta122';

async function signUp() {
  const fullName = document.getElementById('fullname').value.trim();
  const matric = document.getElementById('matric').value.trim();
  const msg = document.getElementById('auth-message');

  if (!fullName || !matric) {
    msg.textContent = 'Enter the name you want to be called and your matric number.';
    return;
  }

  const { error } = await sb.auth.signUp({
    email: matricEmail(matric),
    password: matricPass(matric),
    options: { data: { full_name: fullName } }
  });

  if (error) {
    if (/already registered/i.test(error.message)) {
      msg.textContent = 'This matric number is already registered. Tap Login.';
    } else if (/database error/i.test(error.message)) {
      msg.textContent = 'Matric number not found on the class list.';
    } else {
      msg.textContent = error.message;
    }
    return;
  }
  msg.textContent = 'Welcome, ' + fullName + '!';
}

async function signIn() {
  const matric = document.getElementById('matric').value.trim();
  const msg = document.getElementById('auth-message');

  if (!matric) {
    msg.textContent = 'Enter your matric number.';
    return;
  }

  const { error } = await sb.auth.signInWithPassword({
    email: matricEmail(matric),
    password: matricPass(matric)
  });
  msg.textContent = error ? 'Not registered yet. Tap Sign Up first.' : '';
}

async function logOut() {
  await sb.auth.signOut();
}

sb.auth.onAuthStateChange((event, session) => {
  updateUI(session);
});

// ===== SHOW / HIDE LOGIN vs HOME =====
function updateUI(session) {
  const authContainer = document.getElementById('auth-container');
  const appContainer = document.getElementById('app-container');

  if (session) {
    authContainer.style.display = 'none';
    appContainer.style.display = 'block';
    setTimeout(() => loadDashboard(session), 0);
  } else {
    authContainer.style.display = '';
    appContainer.style.display = 'none';
  }
}

// ===== VIEW SWITCHING =====
function showView(view, linkEl) {
  ['home', 'notes', 'mynotes', 'assignments', 'claim', 'friends', 'chat'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = (v === view) ? '' : 'none';
  });
  document.querySelectorAll('.tb-links a').forEach(a => a.classList.remove('active'));
  if (linkEl) linkEl.classList.add('active');
}

// ===== HOME DASHBOARD =====
let dash = { topics: [], assignments: [], events: [] };
let activeCourse = 'All';
let asgStatus = {};
let asgFilter = 'All';
let claimTarget = null;
let myUserId = null;
let myName = null;
let allStudents = [];
let chatWith = null;

async function loadDashboard(session) {
  myUserId = session.user.id;

  const { data: student } = await sb
    .from('students')
    .select('full_name')
    .eq('user_id', session.user.id)
    .maybeSingle();

  myName = student?.full_name || session.user.email;
  document.getElementById('user-label').textContent = 'Hi, ' + myName;

  const [t, p] = await Promise.all([
    sb.from('topics').select('*').order('created_at', { ascending: false }),
    sb.from('posts').select('*').order('created_at', { ascending: false })
  ]);

  const posts = p.data || [];
  const now = new Date();

  dash.topics = t.data || [];
  dash.assignments = posts.filter(x => x.type === 'assignment');
  dash.events = posts
    .filter(x => x.type === 'event' && x.event_date && new Date(x.event_date) >= now)
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

  await loadStatus(session.user.id);

  document.getElementById('stat-notes').textContent = dash.topics.length;
  document.getElementById('stat-assignments').textContent = dash.assignments.length;
  document.getElementById('stat-events').textContent = dash.events.length;

  renderList();
  renderEvents();
  renderNotesGrid();
  renderAssignmentsGrid();
  await initFriends();   // loads allStudents first
  await initMyNotes();   // then notes, so name lookups work
}

function renderList() {
  const q = (document.getElementById('search').value || '').toLowerCase();
  const items = dash.assignments.map(x => ({ title: x.title, sub: x.body, date: x.due_date || x.created_at }));
  const shown = items.filter(i => ((i.title || '') + ' ' + (i.sub || '')).toLowerCase().includes(q)).slice(0, 8);

  document.getElementById('list-items').innerHTML = shown.length
    ? shown.map(i => `
        <div class="item">
          <div class="item-icon">📌</div>
          <div class="item-text"><h4>${esc(i.title)}</h4><p>${esc(i.sub)}</p></div>
          <div class="item-date">${fmt(i.date)}</div>
        </div>`).join('')
    : '<p class="empty">No assignments yet.</p>';
}

function renderEvents() {
  const el = document.getElementById('events-list');
  const shown = dash.events.slice(0, 3);
  el.innerHTML = shown.length
    ? shown.map(e => {
        const d = new Date(e.event_date);
        return `
          <div class="event">
            <div class="event-date">
              <small>${d.toLocaleString('en-US', { month: 'short' }).toUpperCase()}</small>
              <b>${d.getDate()}</b>
            </div>
            <div>
              <h4>${esc(e.title)}</h4>
              <p>${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>`;
      }).join('')
    : '<p class="empty">No upcoming events.</p>';
}

// ===== NOTES PAGE (browse topics) =====
function renderNotesGrid() {
  const grid = document.getElementById('notes-grid');
  const chips = document.getElementById('course-chips');
  if (!grid || !chips) return;

  const courses = ['All', ...new Set(dash.topics.map(t => t.course_code))];
  chips.innerHTML = courses.map(c => `
    <div class="chip ${c === activeCourse ? 'active' : ''}" onclick="setCourseFilter('${esc(c)}')">${esc(c)}</div>
  `).join('');

  const q = (document.getElementById('notes-search').value || '').toLowerCase();
  const filtered = dash.topics.filter(t => {
    const matchesCourse = activeCourse === 'All' || t.course_code === activeCourse;
    const matchesSearch = ((t.title || '') + ' ' + (t.description || '')).toLowerCase().includes(q);
    return matchesCourse && matchesSearch;
  });

  document.getElementById('notes-total').textContent = dash.topics.length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  document.getElementById('notes-new').textContent =
    dash.topics.filter(t => new Date(t.created_at).getTime() > weekAgo).length;

  grid.innerHTML = filtered.length
    ? filtered.map(t => `
        <div class="note-card">
          <div class="note-thumb">📄</div>
          <div class="note-body">
            <div class="note-date">${fmt(t.created_at)}</div>
            <h4>${esc(t.title)}</h4>
            <p>${esc(t.description)}</p>
            <div class="note-tags">
              <span class="note-tag dark">${esc(t.course_code)}</span>
              <span class="note-tag">${t.section === 'practical' ? 'Practical' : 'Theory'}</span>
            </div>
          </div>
        </div>`).join('')
    : '<p class="empty">No notes match your search.</p>';
}

function setCourseFilter(c) {
  activeCourse = c;
  renderNotesGrid();
}

// ===== MY NOTES (write / share) =====
async function initMyNotes() {
  const select = document.getElementById('note-topic');
  select.innerHTML = dash.topics.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
  await renderMyNotes();
}

async function saveNote() {
  const topicId = document.getElementById('note-topic').value;
  const content = document.getElementById('note-content').value.trim();
  const shared = document.getElementById('note-shared').checked;
  const msg = document.getElementById('note-message');

  if (!content || !topicId) { msg.textContent = 'Pick a topic and write something.'; return; }

  const { error } = await sb.from('notes').insert({
    user_id: myUserId, topic_id: topicId, content,
    visibility: shared ? 'shared' : 'private'
  });

  if (error) { msg.textContent = error.message; return; }
  document.getElementById('note-content').value = '';
  document.getElementById('note-shared').checked = false;
  msg.textContent = 'Saved.';
  renderMyNotes();
  renderSharedNotes();
}

async function renderMyNotes() {
  const { data } = await sb.from('notes').select('*, topics(title)').eq('user_id', myUserId).order('created_at', { ascending: false });
  const el = document.getElementById('my-notes-list');
  el.innerHTML = (data || []).length
    ? data.map(n => `
        <div class="item">
          <div class="item-icon">📝</div>
          <div class="item-text">
            <h4>${esc(n.topics?.title || 'Untitled')}</h4>
            <p class="clamp" onclick="this.classList.toggle('clamp')">${esc(n.content)}</p>
          </div>
          <div class="item-date">${n.visibility === 'shared' ? 'Shared' : 'Private'}</div>
        </div>`).join('')
    : '<p class="empty">No notes yet.</p>';
}

// ===== ASSIGNMENTS =====
async function loadStatus(userId) {
  const { data } = await sb.from('assignment_status').select('*').eq('user_id', userId);
  asgStatus = {};
  (data || []).forEach(s => asgStatus[s.post_id] = s.completed);
}

async function toggleDone(postId, userId) {
  const done = !asgStatus[postId];
  asgStatus[postId] = done;
  await sb.from('assignment_status').upsert({ user_id: userId, post_id: postId, completed: done });
  renderAssignmentsGrid();
}

function setAsgFilter(f, chip) {
  asgFilter = f;
  document.querySelectorAll('#assignments-page .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  renderAssignmentsGrid();
}

async function renderAssignmentsGrid() {
  const grid = document.getElementById('asg-grid');
  if (!grid) return;
  const { data: { session } } = await sb.auth.getSession();
  const userId = session?.user?.id;

  const q = (document.getElementById('asg-search').value || '').toLowerCase();
  const now = new Date();

  let list = dash.assignments.map(a => {
    const done = !!asgStatus[a.id];
    const overdue = a.due_date && new Date(a.due_date) < now && !done;
    return { ...a, done, overdue };
  });

  document.getElementById('asg-total').textContent = list.length;
  document.getElementById('asg-pending').textContent = list.filter(a => !a.done).length;
  document.getElementById('asg-done').textContent = list.filter(a => a.done).length;

  list = list.filter(a => ((a.title || '') + ' ' + (a.body || '')).toLowerCase().includes(q));
  if (asgFilter === 'Pending') list = list.filter(a => !a.done && !a.overdue);
  if (asgFilter === 'Completed') list = list.filter(a => a.done);
  if (asgFilter === 'Overdue') list = list.filter(a => a.overdue);

  grid.innerHTML = list.length
    ? list.map(a => `
        <div class="note-card">
          <div class="note-thumb">📌</div>
          <div class="note-body">
            <div class="note-date">Due ${fmt(a.due_date)}</div>
            <h4>${esc(a.title)}</h4>
            <p>${esc(a.body)}</p>
            <span class="status-badge ${a.done ? 'status-done' : 'status-pending'}">${a.done ? 'Completed' : (a.overdue ? 'Overdue' : 'Pending')}</span>
            <span class="note-tag mark" onclick="toggleDone('${a.id}', '${userId}')">${a.done ? 'Mark pending' : 'Mark done'}</span>
            <span class="note-tag claim" onclick="raiseClaim('${a.id}', '${userId}', '${esc(a.title).replace(/'/g, "\\'")}')">Raise a claim</span>
            ${a.solution ? `<span class="note-tag" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">See solution</span><div style="display:none; margin-top:8px; font-size:0.85rem; color:#4A0E20;">${esc(a.solution)}</div>` : ''}
          </div>
        </div>`).join('')
    : '<p class="empty">No assignments match.</p>';
}

// ===== CLAIM =====
function raiseClaim(postId, userId, title) {
  claimTarget = { postId, userId };
  document.getElementById('claim-title').textContent = title;
  document.getElementById('claim-reason').value = '';
  document.getElementById('claim-message').textContent = '';
  showView('claim', null);
}

async function submitClaim() {
  const reason = document.getElementById('claim-reason').value.trim();
  const msg = document.getElementById('claim-message');
  if (!reason) { msg.textContent = 'Please describe the issue.'; return; }

  const { error } = await sb.from('claims').insert({
    user_id: claimTarget.userId,
    post_id: claimTarget.postId,
    reason
  });

  if (error) { msg.textContent = 'Could not submit: ' + error.message; return; }
  msg.textContent = '';
  showView('assignments', document.querySelectorAll('.tb-links a')[3]);
}

// ===== FRIENDS =====
async function initFriends() {
  const { data } = await sb.from('students').select('user_id, full_name').not('user_id', 'is', null);
  allStudents = (data || []).filter(s => s.user_id !== myUserId);
  renderFriendsList();
  renderSharedNotes();
}

function renderFriendsList() {
  const q = (document.getElementById('friend-search')?.value || '').toLowerCase();
  const el = document.getElementById('friends-list');
  if (!el) return;
  const shown = allStudents.filter(s => (s.full_name || '').toLowerCase().includes(q));

  el.innerHTML = shown.length
    ? shown.map(s => `
        <div class="item" style="cursor:pointer;" onclick="openChat('${s.user_id}', '${esc(s.full_name).replace(/'/g, "\\'")}')">
          <div class="item-icon">👤</div>
          <div class="item-text"><h4>${esc(s.full_name)}</h4><p>Tap to message</p></div>
        </div>`).join('')
    : '<p class="empty">No classmates found. Once others sign up, they\'ll show up here.</p>';
}

// No FK join between notes and students — both just reference auth.users.
// Look up names in JS instead, from the already-loaded allStudents list.
async function renderSharedNotes() {
  const { data } = await sb.from('notes')
    .select('*')
    .eq('visibility', 'shared')
    .order('created_at', { ascending: false })
    .limit(20);

  const el = document.getElementById('shared-notes-list');
  if (!el) return;

  const nameFor = uid => uid === myUserId ? (myName || 'You') : (allStudents.find(s => s.user_id === uid)?.full_name || 'A classmate');

  el.innerHTML = (data || []).length
    ? data.map(n => `
        <div class="note-card">
          <div class="note-thumb">📝</div>
          <div class="note-body">
            <h4>${esc(nameFor(n.user_id))}</h4>
            <p class="clamp" onclick="this.classList.toggle('clamp')">${esc(n.content)}</p>
            <span class="note-tag claim" onclick="reportNote('${n.id}')">Report mistake</span>
          </div>
        </div>`).join('')
    : '<p class="empty">No shared notes yet.</p>';
}

async function reportNote(noteId) {
  const reason = prompt('What\'s wrong with this note?');
  if (!reason || !reason.trim()) return;
  const { error } = await sb.from('reports').insert({ note_id: noteId, reported_by: myUserId, reason: reason.trim() });
  alert(error ? 'Could not report: ' + error.message : 'Reported. Thanks!');
}

// ===== CHAT =====
async function openChat(userId, name) {
  chatWith = userId;
  document.getElementById('chat-with').textContent = name;
  showView('chat', null);
  await loadChat();
}

async function loadChat() {
  const { data } = await sb.from('messages')
    .select('*')
    .or(`and(sender_id.eq.${myUserId},receiver_id.eq.${chatWith}),and(sender_id.eq.${chatWith},receiver_id.eq.${myUserId})`)
    .order('created_at', { ascending: true });

  const el = document.getElementById('chat-thread');
  el.innerHTML = (data || []).map(m => `
    <div style="margin-bottom:10px; text-align:${m.sender_id === myUserId ? 'right' : 'left'};">
      <span style="display:inline-block; background:${m.sender_id === myUserId ? 'var(--maroon)' : '#EFEAE4'}; color:${m.sender_id === myUserId ? '#fff' : '#2B1810'}; padding:8px 14px; border-radius:14px; max-width:80%;">${esc(m.content)}</span>
    </div>`).join('');
  el.scrollTop = el.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  await sb.from('messages').insert({ sender_id: myUserId, receiver_id: chatWith, content });
  loadChat();
}