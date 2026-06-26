// ==========================================
// 1. DATABASE & INITIAL CONFIGURATION
// ==========================================
const db = new Dexie("PlannerProDatabase");
db.version(2).stores({
    tasks: '++id, userId, text, completed, recurrence, reminderDate, syncStatus',
    notes: '++id, userId, title, body, timestamp, syncStatus'
});

// Configure Supabase Access credentials
const SUPABASE_URL = "https://supabase.co"; 
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
const supabase =  supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;

// Pomodoro Timer Internal Config Configuration
let timerInterval = null;
let currentMode = 'work'; // Options: work, short, long
let timerSettings = { work: 1500, short: 300, long: 900 }; // Saved in seconds
let timerSeconds = 1500;

let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

// ==========================================
// 2. AUTHENTICATION CONTROLLER SYSTEM
// ==========================================
window.addEventListener('load', async () => {
    // Check if a browser user session is active from a previous run
    const { data: { session } } = await supabase.auth.getSession();
    handleAuthChange(session);

    // Dynamic Cloud listener running in background context
    supabase.auth.onAuthStateChange((_event, session) => {
        handleAuthChange(session);
    });

    initReminders();
    setupOnlineStatusIndicator();
});

function handleAuthChange(session) {
    if (session) {
        currentUser = session.user;
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('app-layout').style.display = 'flex';
        document.getElementById('user-display').textContent = `Logged in: ${currentUser.email}`;
        switchTab('tasks');
        renderAll();
    } else {
        currentUser = null;
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('app-layout').style.display = 'none';
    }
}

async function handleSignUp() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) document.getElementById('auth-error').textContent = error.message;
    else alert("Registration check! Please verify confirmation email links.");
}

async function handleLogin() {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) document.getElementById('auth-error').textContent = error.message;
}

async function handleLogout() {
    await supabase.auth.signOut();
}

function renderAll() {
    if (!currentUser) return;
    renderTasks();
    renderNotes();
}

// ==========================================
// 3. TASKS STORAGE ROUTINES (USER FILTERED)
// ==========================================
async function renderTasks() {
    const listElement = document.getElementById('task-list');
    listElement.innerHTML = '';
    
    // Filter database rows uniquely linked to the current logged-in user profile
    const tasks = await db.tasks.where('userId').equals(currentUser.id).toArray();

    tasks.forEach(task => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = task.completed;
        cb.onclick = () => toggleTaskComplete(task.id, task.completed, task.recurrence);
        
        const span = document.createElement('span');
        span.textContent = `${task.text} ${task.recurrence !== 'none' ? `(🔁 ${task.recurrence})` : ''}`;
        if(task.completed) span.className = 'completed-text';

        label.appendChild(cb);
        label.appendChild(span);
        
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.style.background = 'var(--danger)';
        delBtn.onclick = () => { db.tasks.delete(task.id); renderAll(); triggerCloudSync(); };

        li.appendChild(label);
        li.appendChild(delBtn);
        listElement.appendChild(li);
    });
}

async function addNewTask() {
    const text = document.getElementById('task-text').value.trim();
    const recurrence = document.getElementById('task-recurrence').value;
    const reminderDate = document.getElementById('task-reminder').value;

    if(!text || !currentUser) return;

    await db.tasks.add({
        userId: currentUser.id,
        text,
        recurrence,
        reminderDate: reminderDate ? new Date(reminderDate).toISOString() : null,
        completed: 0,
        syncStatus: 'pending'
    });

    document.getElementById('task-text').value = '';
    renderAll();
    triggerCloudSync();
}

async function toggleTaskComplete(id, currentStatus, recurrence) {
    if(!currentStatus && recurrence !== 'none') {
        const oldTask = await db.tasks.get(id);
        let nextDate = new Date();
        if(recurrence === 'daily') nextDate.setDate(nextDate.getDate() + 1);
        if(recurrence === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
        
        await db.tasks.add({
            ...oldTask,
            id: undefined,
            reminderDate: nextDate.toISOString(),
            syncStatus: 'pending'
        });
    }

    await db.tasks.update(id, { completed: currentStatus ? 0 : 1, syncStatus: 'pending' });
    renderAll();
    triggerCloudSync();
}

// ==========================================
// 4. POMODORO CUSTOM CONTROLLER
// ==========================================
function applyTimerSettings() {
    const workMin = parseInt(document.getElementById('cfg-work').value) || 25;
    const shortMin = parseInt(document.getElementById('cfg-short').value) || 5;
    const longMin = parseInt(document.getElementById('cfg-long').value) || 15;

    // Convert runtime definitions into integer bounds
    timerSettings.work = workMin * 60;
    timerSettings.short = shortMin * 60;
    timerSettings.long = longMin * 60;

    resetTimer();
    alert("Timer configuration updated!");
}

function setTimerMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.timer-modes button').forEach(b => b.classList.remove('active-mode'));
    document.getElementById(`mode-${mode}`).classList.add('active-mode');
    resetTimer();
}

function toggleTimer() {
    const btn = document.getElementById('timer-start');
    if(timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
        btn.textContent = 'Start';
    } else {
        btn.textContent = 'Pause';
        timerInterval = setInterval(() => {
            timerSeconds--;
            updateTimerUI();
            if(timerSeconds <= 0) {
                clearInterval(timerInterval);
                timerInterval = null;
                new Notification("Interval Complete!", { body: `Mode ${currentMode} finished!` });
                resetTimer();
            }
        }, 1000);
    }
}

function resetTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSeconds = timerSettings[currentMode];
    updateTimerUI();
    document.getElementById('timer-start').textContent = 'Start';
}

function updateTimerUI() {
    const mins = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
    const secs = (timerSeconds % 60).toString().padStart(2, '0');
    document.getElementById('timer-display').textContent = `${mins}:${secs}`;
}

// ==========================================
// 5. CALENDAR GRID MODULE
// ==========================================
async function renderCalendar() {
    if(!currentUser) return;
    const grid = document.getElementById('calendar-grid');
    const title = document.getElementById('calendar-month-year');
    grid.innerHTML = '';

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    title.textContent = `${monthNames[currentMonth]} ${currentYear}`;

    for(let i=0; i<firstDay; i++) {
        const div = document.createElement('div');
        div.className = 'calendar-day';
        grid.appendChild(div);
    }

    const tasks = await db.tasks.where('userId').equals(currentUser.id).toArray();

    for(let day=1; day<=daysInMonth; day++) {
        const div = document.createElement('div');
        div.className = 'calendar-day';
        div.innerHTML = `<strong>${day}</strong>`;

        const currentTargetStr = new Date(currentYear, currentMonth, day).toDateString();
        tasks.forEach(t => {
            if(t.reminderDate && new Date(t.reminderDate).toDateString() === currentTargetStr) {
                const eventEl = document.createElement('div');
                eventEl.className = 'calendar-event';
                eventEl.textContent = t.text;
                div.appendChild(eventEl);
            }
        });
        grid.appendChild(div);
    }
}

function changeMonth(direction) {
    currentMonth += direction;
    if(currentMonth > 11) { currentMonth = 0; currentYear++; }
    if(currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
}

// ==========================================
// 6. SCRATCHPAD NOTES MODULE
// ==========================================
async function renderNotes() {
    const container = document.getElementById('notes-container');
    container.innerHTML = '';
    const notes = await db.notes.where('userId').equals(currentUser.id).toArray();

    notes.forEach(note => {
        const card = document.createElement('div');
        card.className = 'note-card';

card.innerHTML = `
    <h4>${note.title}</h4>
    <p>${note.body}</p>
    <button
        style="background: var(--danger); font-size: 10px; padding: 4px;"
        onclick="deleteNote(${note.id})"
    >
        Delete
    </button>
`;

container.appendChild(card);
});
}

async function addNewNote() {
    const title = document.getElementById('note-title').value.trim();
    const body = document.getElementById('note-body').value.trim();

    if (!title || !body || !currentUser) return;

    await db.notes.add({
        userId: currentUser.id,
        title,
        body,
        timestamp: Date.now(),
        syncStatus: 'pending'
    });

    document.getElementById('note-title').value = '';
    document.getElementById('note-body').value = '';

    renderNotes();
    triggerCloudSync();
}

async function deleteNote(id) {
    await db.notes.delete(id);
    renderNotes();
    triggerCloudSync();
}

// ==========================================
// 7. BACKGROUND POLLING REMINDERS
// ==========================================

function initReminders() {
    if (Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    setInterval(async () => {
        if (!currentUser) return;

        const now = new Date().toISOString();

        const tasks = await db.tasks
            .where('userId')
            .equals(currentUser.id)
            .filter(task =>
                task.reminderDate &&
                task.reminderDate <= now &&
                !task.completed
            )
            .toArray();

        tasks.forEach(task => {
            new Notification("Task Reminder!", {
                body: task.text
            });

            db.tasks.update(task.id, {
                reminderDate: null
            });
        });
    }, 10000);
}

// ==========================================
// 8. MULTI-DEVICE DATA SYNC CONTROLLER
// ==========================================

function setupOnlineStatusIndicator() {
    const status = document.getElementById('sync-status');

    const updateStatus = () => {
        if (navigator.onLine) {
            status.textContent = "🟢 Connected & Syncing";
            status.style.background = "#234e52";
            triggerCloudSync();
        } else {
            status.textContent = "⚠️ Working Offline";
            status.style.background = "#742a2a";
        }
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);

    updateStatus();
}

async function triggerCloudSync() {
    if (!navigator.onLine || !currentUser) return;

    const pendingTasks = await db.tasks
        .where('syncStatus')
        .equals('pending')
        .toArray();

    for (const task of pendingTasks) {
        try {
            const { error } = await supabase
                .from('tasks')
                .upsert({
                    user_id: currentUser.id,
                    text: task.text,
                    completed: task.completed,
                    recurrence: task.recurrence
                });

            if (!error) {
                await db.tasks.update(task.id, {
                    syncStatus: 'synced'
                });
            }
        } catch (err) {
            console.error("Sync structural network failure:", err);
        }
    }
}

function switchTab(tabName) {
    document
        .querySelectorAll('.tab-content')
        .forEach(el => el.classList.remove('active'));

    document
        .getElementById(`tab-${tabName}`)
        .classList.add('active');

    if (tabName === 'calendar') {
        renderCalendar();
    }
}
