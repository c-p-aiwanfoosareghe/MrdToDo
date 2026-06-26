const todoInput = document.getElementById('todo-input');
const addBtn = document.getElementById('add-btn');
const todoList = document.getElementById('todo-list');

// Load tasks or initialize empty list. Now using object format: { text: "", completed: false }
let tasks = JSON.parse(localStorage.getItem('myOfflineTodos')) || [];

function renderTasks() {
    todoList.innerHTML = ''; 
    
    tasks.forEach((task, index) => {
        const li = document.createElement('li');

        // Container for checkbox and text
        const leftSide = document.createElement('div');
        leftSide.className = 'todo-item-left';

        // Checkbox element
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.completed;
        checkbox.onclick = () => toggleComplete(index);

        // Text element
        const taskSpan = document.createElement('span');
        taskSpan.textContent = task.text;
        if (task.completed) {
            taskSpan.className = 'completed-text';
        }

        leftSide.appendChild(checkbox);
        leftSide.appendChild(taskSpan);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'X';
        deleteBtn.className = 'delete-btn';
        deleteBtn.onclick = () => deleteTask(index);

        li.appendChild(leftSide);
        li.appendChild(deleteBtn);
        todoList.appendChild(li);
    });
}

function addTask() {
    const taskText = todoInput.value.trim();
    if (taskText === '') return;

    // Push task as an object
    tasks.push({ text: taskText, completed: false }); 
    saveToStorage();      
    renderTasks();        
    todoInput.value = ''; 
}

function deleteTask(index) {
    tasks.splice(index, 1); 
    saveToStorage();        
    renderTasks();          
}

// Toggle the completion state of a task
function toggleComplete(index) {
    tasks[index].completed = !tasks[index].completed;
    saveToStorage();
    renderTasks();
}

function saveToStorage() {
    localStorage.setItem('myOfflineTodos', JSON.stringify(tasks));
}

addBtn.addEventListener('click', addTask);
todoInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTask();
});

renderTasks();
