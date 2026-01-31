// Dashboard App
(function() {
    const PASS_HASH = '69a82982c9bf8c7670629ebfda7a14fb245b9c52306dc67e9969a27f627e50a5'; // sha256 of password
    
    function sha256(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        return crypto.subtle.digest('SHA-256', data).then(hash => {
            return Array.from(new Uint8Array(hash))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        });
    }
    
    async function checkAuth() {
        const stored = sessionStorage.getItem('tony_auth');
        if (stored === PASS_HASH) {
            document.body.style.display = 'block';
            return true;
        }
        
        const pass = prompt('🔒 Пароль для доступа:');
        if (!pass) {
            document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;color:#8b949e;font-family:Inter,sans-serif;">Доступ запрещён</div>';
            document.body.style.display = 'block';
            return false;
        }
        
        const hash = await sha256(pass);
        if (hash === PASS_HASH) {
            sessionStorage.setItem('tony_auth', hash);
            document.body.style.display = 'block';
            return true;
        } else {
            document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;color:#f85149;font-family:Inter,sans-serif;">Неверный пароль</div>';
            document.body.style.display = 'block';
            return false;
        }
    }
    
    checkAuth().then(ok => {
        if (ok) updateDashboard();
    });
})();

document.addEventListener('DOMContentLoaded', () => {
    // Auth handles initial load
});

function updateDashboard() {
    // Update stats
    document.getElementById('days-active').textContent = dashboardData.stats.daysActive;
    document.getElementById('tasks-done').textContent = dashboardData.stats.tasksDone;
    document.getElementById('subagents').textContent = dashboardData.stats.subagentsRun;
    document.getElementById('cron-jobs').textContent = dashboardData.stats.cronJobs;
    
    // Update status
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('status-text');
    if (dashboardData.status === 'online') {
        statusDot.classList.remove('offline');
        statusText.textContent = 'Online';
    } else {
        statusDot.classList.add('offline');
        statusText.textContent = 'Offline';
    }
    
    // Update last update time
    const lastUpdate = new Date(dashboardData.lastUpdate);
    document.getElementById('last-update').textContent = formatDate(lastUpdate);
    
    // Render tasks
    renderTasks();
    
    // Render activity log
    renderActivityLog();
    
    // Update goal progress
    updateGoalProgress();
}

function renderTasks() {
    // Waiting tasks
    const waitingContainer = document.getElementById('waiting-tasks');
    waitingContainer.innerHTML = dashboardData.tasks.waiting.map(task => `
        <div class="task-card">
            <div class="task-title">${task.title}</div>
            <div class="task-desc">${task.desc}</div>
        </div>
    `).join('');
    
    // Planned tasks
    const plannedContainer = document.getElementById('planned-tasks');
    plannedContainer.innerHTML = dashboardData.tasks.planned.map(task => `
        <div class="task-card">
            <div class="task-title">${task.title}</div>
            <div class="task-desc">${task.desc}</div>
        </div>
    `).join('');
    
    // Done tasks
    const doneContainer = document.getElementById('done-tasks');
    doneContainer.innerHTML = dashboardData.tasks.done.map(task => `
        <div class="task-card completed">
            <div class="task-title">${task.title}</div>
            <div class="task-meta">${task.date}</div>
        </div>
    `).join('');
}

function renderActivityLog() {
    const logContainer = document.getElementById('activity-log');
    logContainer.innerHTML = dashboardData.activityLog.map(entry => `
        <div class="log-entry">
            <span class="log-time">${entry.time}</span>
            <span class="log-text">${entry.text}</span>
        </div>
    `).join('');
}

function updateGoalProgress() {
    const milestone1 = dashboardData.goal.milestones[0];
    const progress1 = (milestone1.current / milestone1.target) * 100;
    document.querySelector('.milestone:first-child .progress').style.width = `${Math.max(progress1, 2)}%`;
    document.querySelector('.milestone:first-child .milestone-status').textContent = 
        `$${milestone1.current} / $${milestone1.target.toLocaleString()}`;
}

function formatDate(date) {
    return date.toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Auto-refresh every 5 minutes
setInterval(() => {
    location.reload();
}, 5 * 60 * 1000);
