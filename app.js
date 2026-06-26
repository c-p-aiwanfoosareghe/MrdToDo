// ==========================================
// 1. DATABASE CONFIGURATION (OFFLINE FIRST)
// ==========================================
const db = new Dexie("PlannerProDatabase");
db.version(1).stores({
    tasks: '++id, text, completed, recurrence, reminderDate, syncStatus',
    notes: '++id, title, body, timestamp, syncStatus'
});

// ==========================================
// 2. STATE & INITIALIZATION
// ==========================================
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let timerInterval = null;
let timerSeconds = 1500; // 25 minutes

window.addEventListener('load', () => {
    switchTab('tasks');
    initReminders();
    renderAll();
    setupOnlineStatusIndicator();
});

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    if(tabName === 'calendar') renderCalendar();
}

function renderAll() {
    renderTasks();
    renderNotes();
}

// ==========================================
// 3. TASKS ENGINE (WITH RECURRING LOGIC)
// ==========================================
async function renderTasks() {
    const listElement = document.getElementById('task-list');
    listElement.innerHTML = '';
    const tasks = await db.tasks.toArray();

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

    if(!text) return;

    await db.tasks.add({
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
        // If a recurring task is completed, handle recurrence mechanics
        const oldTask = await db.tasks.get(id);
        let nextDate = new Date();
        if(recurrence === 'daily') nextDate.setDate(nextDate.getDate() + 1);
        if(recurrence === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
        
        // Spawn the next iteration into database automatically
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
// 4. CALENDAR ENGINE
// ==========================================
async function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const title = document.getElementById('calendar-month-year');
    grid.innerHTML = '';

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    title.textContent = `${monthNames[currentMonth]} ${currentYear}`;

    // Blank Spacers for offset
    for(let i=0; i<firstDay; i++) {
        const div = document.createElement('div');
        div.className = 'calendar-day';
        grid.appendChild(div);
    }

    const tasks = await db.tasks.toArray();

    for(let day=1; day<=daysInMonth; day++) {
        const div = document.createElement('div');
        div.className = 'calendar-day';
        div.innerHTML = `<strong>${day}</strong>`;

        // Check if any matching task matches this calendar index day
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
// 5. POMODORO TIMER ENGINE
// ==========================================
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
                new Notification("Pomodoro Complete!", { body: "Take a break!" });
                resetTimer();
            }
        }, 1000);
    }
}

function resetTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSeconds = 1500;
    updateTimerUI();
    document.getElementById('timer-start').textContent = 'Start';
}

function updateTimerUI() {
    const mins = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
    const secs = (timerSeconds % 60).toString().padStart(2, '0');
    document.getElementById('timer-display').textContent = `${mins}:${secs}`;
}

// ==========================================
// 6. SCRATCHPAD NOTES ENGINE
// ==========================================
async function renderNotes() {
    const container = document.getElementById('notes-container');
    container.innerHTML = '';
    const notes = await db.notes.toArray();

    notes.forEach(note => {
        const card = document.createElement('div');
        card.className = 'note-card';
        card.innerHTML = `
            <h4>${note.title}</h4>
            <p>${note.body}</p>
            <button style="background:var(--danger); font-size:10px; padding:4px;" onclick="deleteNote(${note.id})">Delete</button>
        `;
        container.appendChild(card);
    });
}

async function addNewNote() {
    const title = document.getElementById('note-title').value.trim();
    const body = document.getElementById('note-body').value.trim();
    if(!title || !body) return;

    await db.notes.add({ title, body, timestamp: Date.now(), syncStatus: 'pending' });
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
// 7. BACKGROUND REMINDERS (ALERTS)
// ==========================================
function initReminders() {
    if (Notification.permission !== "granted") Notification.requestPermission();
    
    setInterval(async () => {
        const now = new Date().toISOString();
        const tasks = await db.tasks.filter(t => t.reminderDate && t.reminderDate <= now && !t.completed).toArray();
        
        tasks.forEach(task => {
            new Notification("Task Reminder!", { body: task.text });
            db.tasks.update(task.id, { reminderDate: null }); // Clear fired alert
        });
    }, 10000); // Poll local index every 10 seconds
}

// ==========================================
// 8. CLOUD SYNC ARCHITECTURE
// ==========================================
function setupOnlineStatusIndicator() {
    const status = document.getElementById('sync-status');
    const updateStatus = () => {
        if(navigator.onLine) {
            status.textContent = "🟢 Connected & Syncing";
            status.style.background = "#234e52";
            triggerCloudSync();
        } else {
            status.textContent = "⚠️ Working Offline (Saved Local)";
            status.style.background = "#742a2a";
        }
    };
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
}

async function triggerCloudSync() {
    if (!navigator.onLine) return;

    // This loop scans elements needing transmission to the cloud
    const pendingTasks = await db.tasks.where('syncStatus').equals('pending').toArray();
    
    if(pendingTasks.length === 0) return;

    // INTERFACE TO BACKEND (Example using Supabase / REST Endpoint)
    // Replace with your real Supabase credentials when ready to connect:
    /*
    const SUPABASE_URL = "https://supabase.co";
