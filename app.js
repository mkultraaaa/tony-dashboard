// Dashboard App
document.addEventListener('DOMContentLoaded', () => {
    updateDashboard();
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
