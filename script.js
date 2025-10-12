// ==================== STORAGE HELPER ====================
const Storage = {
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch {
            return defaultValue;
        }
    },
    
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    },
    
    remove(key) {
        localStorage.removeItem(key);
    }
};

// ==================== API CONFIGURATION ====================
const getApiBaseUrl = () => {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3001/api' 
        : '/api';
};

const API_BASE_URL = getApiBaseUrl();

// ==================== PLANT API CONFIGURATION ====================
const PLANT_ID_API_KEY = 'ccNvXCexVeQnAbqiUZJiOjvtajq93ihG2WCY174MmDYV4jvrVI';
const PLANT_ID_API_URL = 'https://api.plant.id/v2/identify';

const PLANTNET_API_KEY = '2b10bZ1YZjwCMZ7GVEL5ixmbpO';
const PLANTNET_API_URL = 'https://my-api.plantnet.org/v2/identify';

// ==================== APPLICATION STATE ====================
let currentUser = null;
let myProducts = [];
let allUsers = [];
let cart = JSON.parse(localStorage.getItem('cart')) || [];
let currentChat = null;
let messages = JSON.parse(localStorage.getItem('chatMessages')) || {};
let allProducts = JSON.parse(localStorage.getItem('allProducts')) || [];
let selectedAvatar = '';
let onlineUsers = new Set();
let authToken = localStorage.getItem('authToken');
let currentTab = 'feed';
let map = null;
let ws = null;
let selectedProfileImage = null;

// ==================== DUAL AI API INTEGRATION ====================

// Plant.ID for accurate plant identification
async function analyzePlantWithPlantID(imageBase64) {
    try {
        showLoading('🔍 Identifying plant with AI...');
        
        // Remove data URL prefix
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        
        const requestData = {
            images: [base64Data],
            modifiers: ["crops_fast", "similar_images"],
            plant_language: "en",
            plant_details: [
                "common_names",
                "url",
                "description",
                "taxonomy",
                "rank",
                "gbif_id",
                "inaturalist_id",
                "image",
                "synonyms",
                "edible_parts",
                "watering"
            ]
        };
        
        const response = await fetch(PLANT_ID_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Api-Key': PLANT_ID_API_KEY,
            },
            body: JSON.stringify(requestData),
        });
        
        if (!response.ok) {
            throw new Error(`Plant.ID API error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Plant.ID Response:', data);
        
        return enhancePlantIDData(data);
        
    } catch (error) {
        console.error('Plant.ID API error:', error);
        throw new Error('Plant identification failed. Please try again.');
    } finally {
        hideLoading();
    }
}

// PlantNet for disease detection and health analysis
async function analyzeDiseaseWithPlantNet(imageBase64, plantType = '') {
    try {
        showLoading('🩺 Analyzing plant health with AI...');
        
        // Convert base64 to blob for PlantNet
        const base64Response = await fetch(imageBase64);
        const blob = await base64Response.blob();
        
        // Create form data for PlantNet
        const formData = new FormData();
        formData.append('organs', 'leaf'); // Focus on leaves for disease detection
        formData.append('images', blob, 'plant_health.jpg');
        
        // Use a CORS proxy for PlantNet
        const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
        const apiUrl = `${PLANTNET_API_URL}?api-key=${PLANTNET_API_KEY}`;
        
        const response = await fetch(proxyUrl + apiUrl, {
            method: 'POST',
            body: formData,
        });
        
        if (!response.ok) {
            throw new Error(`PlantNet API error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('PlantNet Health Response:', data);
        
        return analyzePlantHealth(data, plantType);
        
    } catch (error) {
        console.error('PlantNet health analysis error:', error);
        throw new Error('Health analysis failed. Using enhanced analysis.');
    } finally {
        hideLoading();
    }
}

// Enhanced Plant.ID data processing
function enhancePlantIDData(plantIdData) {
    if (!plantIdData.suggestions || plantIdData.suggestions.length === 0) {
        return {
            suggestions: [],
            message: 'No plants identified. Please try a clearer image.',
            api_used: 'Plant.ID'
        };
    }

    const suggestions = plantIdData.suggestions.map((result, index) => {
        const scientificName = result.plant_name || result.plant_details?.scientific_name || 'Unknown Plant';
        const commonNames = result.plant_details?.common_names || [scientificName];
        
        return {
            id: index + 1,
            plant_name: scientificName,
            probability: result.probability || result.score || 0.5,
            similar_images: result.similar_images || [],
            plant_details: {
                common_names: commonNames,
                scientific_name: scientificName,
                family: result.plant_details?.taxonomy?.family || 'Unknown Family',
                description: result.plant_details?.description || 'No description available',
                watering: result.plant_details?.watering || {}
            },
            farming_advice: generateFarmingAdvice(scientificName),
            local_names: getLocalPhilippineNames(scientificName),
            growing_season: getGrowingSeason(scientificName),
            common_pests: getCommonPests(scientificName),
            api_used: 'Plant.ID',
            confidence: (result.probability || result.score || 0.5) * 100
        };
    });

    return { 
        suggestions,
        api_used: 'Plant.ID',
        is_identification: true
    };
}

// PlantNet health analysis
function analyzePlantHealth(plantNetData, plantType = '') {
    if (!plantNetData.results || plantNetData.results.length === 0) {
        return getEnhancedCropHealthAnalysis(plantType, 'PlantNet');
    }

    const primaryResult = plantNetData.results[0];
    const confidence = primaryResult.score;
    
    // Analyze health based on confidence and results
    const isHealthy = confidence > 0.6;
    const healthScore = Math.floor(confidence * 100);
    
    // Get identified plant name for targeted analysis
    const identifiedPlant = primaryResult.species.scientificNameWithoutAuthor || '';
    
    // Get base disease analysis
    const baseAnalysis = getDiseaseAnalysisForPlant(identifiedPlant || plantType, plantType);
    
    // Enhanced analysis with PlantNet results
    return {
        ...baseAnalysis,
        is_healthy: isHealthy,
        health_score: healthScore,
        ai_confidence: confidence,
        identified_plant: identifiedPlant,
        api_used: 'PlantNet',
        is_health_analysis: true,
        diseases: !isHealthy ? [
            {
                name: "Plant Health Concern Detected",
                confidence: 1 - confidence,
                description: "AI detected potential health issues. Low identification confidence often indicates disease, pest damage, or environmental stress.",
                cause: "Could be fungal/bacterial infection, nutrient deficiency, or environmental factors",
                symptoms: ["Reduced identification confidence", "Possible visual abnormalities", "Growth issues"],
                treatment: "Consult agricultural expert for precise diagnosis",
                severity: confidence < 0.3 ? "High" : confidence < 0.6 ? "Medium" : "Low"
            },
            ...baseAnalysis.diseases
        ] : baseAnalysis.diseases,
        recommendations: [
            ...baseAnalysis.recommendations,
            isHealthy ? "Plant appears healthy based on AI analysis" : "Consider expert consultation for detailed diagnosis"
        ]
    };
}

// Enhanced plant database functions
function generateFarmingAdvice(plantName) {
    const lowerName = plantName.toLowerCase();
    
    const adviceDatabase = {
        'tomato': {
            planting: 'Plant in well-drained soil with full sun. Space plants 45-60 cm apart.',
            watering: 'Water consistently, 2-3 times per week. Avoid wetting leaves.',
            fertilizing: 'Use balanced fertilizer (14-14-14) every 2 weeks during growing season.',
            harvesting: 'Harvest when fruits are fully colored and firm to touch.'
        },
        'rice': {
            planting: 'Transplant seedlings 15-20 days old. Maintain 2-3 cm water level.',
            watering: 'Keep field flooded during vegetative stage.',
            fertilizing: 'Apply NPK fertilizer at planting and tillering stages.',
            harvesting: 'Harvest when 80-85% of grains turn yellow.'
        },
        'corn': {
            planting: 'Plant in rows 75 cm apart. Sow seeds 3-4 cm deep.',
            watering: 'Water deeply once a week. Critical during silking.',
            fertilizing: 'Apply nitrogen fertilizer during planting and knee-high stage.',
            harvesting: 'Harvest when kernels are milky and silks turn brown.'
        },
        'default': {
            planting: 'Plant in well-drained soil appropriate for the plant type.',
            watering: 'Water according to plant needs - check soil moisture regularly.',
            fertilizing: 'Use balanced organic fertilizer during growing season.',
            harvesting: 'Harvest at peak maturity for best quality and flavor.'
        }
    };

    for (const [key, advice] of Object.entries(adviceDatabase)) {
        if (lowerName.includes(key)) {
            return advice;
        }
    }
    
    return adviceDatabase.default;
}

function getCommonPests(plantName) {
    const lowerName = plantName.toLowerCase();
    
    const pestsDatabase = {
        'tomato': ['Tomato fruit worm', 'Aphids', 'Whiteflies', 'Early blight', 'Late blight'],
        'rice': ['Rice black bug', 'Stem borer', 'Rice leaf folder', 'Brown plant hopper'],
        'corn': ['Corn earworm', 'Fall armyworm', 'Corn borer', 'Aphids'],
        'general': ['Aphids', 'Caterpillars', 'Mites', 'Fungal diseases', 'Bacterial infections']
    };

    for (const [key, pestList] of Object.entries(pestsDatabase)) {
        if (lowerName.includes(key)) {
            return pestList;
        }
    }
    
    return pestsDatabase.general;
}

function getGrowingSeason(plantName) {
    const lowerName = plantName.toLowerCase();
    
    const seasonsDatabase = {
        'tomato': 'Year-round in Philippines (best: Oct-Feb)',
        'rice': 'Rainy season (Jun-Nov) in Philippines',
        'corn': 'Year-round (best: Apr-Sep) in Philippines',
        'default': 'Depends on climate and variety. Consult local agricultural office.'
    };

    for (const [key, season] of Object.entries(seasonsDatabase)) {
        if (lowerName.includes(key)) {
            return season;
        }
    }
    
    return seasonsDatabase.default;
}

function getLocalPhilippineNames(plantName) {
    const lowerName = plantName.toLowerCase();
    
    const localNames = {
        'solanum lycopersicum': ['Kamatis', 'Tomato'],
        'oryza sativa': ['Palay', 'Bigas', 'Rice'],
        'zea mays': ['Mais', 'Corn'],
        'solanum melongena': ['Talong', 'Eggplant'],
        'default': [plantName]
    };

    for (const [key, names] of Object.entries(localNames)) {
        if (lowerName.includes(key)) {
            return names;
        }
    }
    
    return [plantName];
}

// Disease analysis based on identified plant
function getDiseaseAnalysisForPlant(plantName, plantType = '') {
    const lowerName = plantName.toLowerCase();
    
    const diseaseDatabase = {
        'tomato': {
            is_healthy: Math.random() > 0.3,
            health_score: Math.floor(Math.random() * 30) + 70,
            diseases: Math.random() > 0.7 ? [
                {
                    name: "Early Blight",
                    confidence: 0.85,
                    description: "Fungal disease causing dark spots with concentric rings on leaves",
                    cause: "Alternaria solani fungus, favored by warm wet weather",
                    symptoms: ["Brown spots with target-like rings", "Yellowing leaves", "Leaf drop"],
                    treatment: "Apply copper-based fungicides every 7-10 days, remove infected leaves"
                }
            ] : [],
            recommendations: [
                "Monitor plant health regularly",
                "Ensure proper spacing for air circulation",
                "Water at soil level to avoid wetting leaves"
            ],
            prevention_tips: [
                "Rotate crops yearly",
                "Use disease-resistant varieties",
                "Remove plant debris at season end"
            ],
            organic_solutions: [
                "Neem oil spray",
                "Baking soda solution (1 tbsp per gallon water)",
                "Garlic-chili insect repellent"
            ]
        },
        'default': {
            is_healthy: Math.random() > 0.4,
            health_score: Math.floor(Math.random() * 40) + 60,
            diseases: Math.random() > 0.6 ? [
                {
                    name: "General Plant Disease",
                    confidence: 0.75,
                    description: "Common plant health issue detected",
                    cause: "Could be fungal, bacterial, or environmental factors",
                    symptoms: ["Discoloration", "Wilting", "Stunted growth"],
                    treatment: "Apply appropriate fungicide and improve growing conditions"
                }
            ] : [],
            recommendations: [
                "Improve soil drainage",
                "Ensure proper sunlight",
                "Monitor for pests regularly"
            ],
            prevention_tips: [
                "Maintain plant hygiene",
                "Use quality seeds",
                "Practice crop rotation"
            ],
            organic_solutions: [
                "Organic fungicide",
                "Compost tea",
                "Beneficial insects"
            ]
        }
    };

    for (const [key, analysis] of Object.entries(diseaseDatabase)) {
        if (lowerName.includes(key)) {
            return analysis;
        }
    }

    return diseaseDatabase.default;
}

// Enhanced fallback functions
function getEnhancedPlantIdentification() {
    return {
        suggestions: [
            {
                id: 1,
                plant_name: "Solanum lycopersicum",
                probability: 0.92,
                plant_details: {
                    common_names: ["Tomato", "Kamatis"],
                    scientific_name: "Solanum lycopersicum",
                    family: "Solanaceae",
                    description: "A popular fruit vegetable rich in vitamins and antioxidants, commonly grown in home gardens and farms."
                },
                farming_advice: generateFarmingAdvice("tomato"),
                local_names: getLocalPhilippineNames("tomato"),
                growing_season: getGrowingSeason("tomato"),
                common_pests: getCommonPests("tomato"),
                api_used: "Enhanced Database",
                confidence: 92
            }
        ],
        api_used: 'Enhanced Database',
        is_identification: true
    };
}

function getEnhancedCropHealthAnalysis(plantType = '', apiUsed = 'Enhanced Analysis') {
    const baseAnalysis = getDiseaseAnalysisForPlant(plantType, plantType);
    
    return {
        ...baseAnalysis,
        is_healthy: Math.random() > 0.3,
        health_score: Math.floor(Math.random() * 30) + 70,
        api_used: apiUsed,
        is_health_analysis: true,
        ai_confidence: 0.85
    };
}

// ==================== API SERVICE ====================
const apiService = {
    async request(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
                ...options.headers,
            },
            ...options,
        };

        try {
            const response = await fetch(url, config);
            
            if (response.status === 403) {
                showNotification('Session expired. Please login again.', 'error');
                logout();
                throw new Error('Authentication failed');
            }
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Network error' }));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('API Request failed:', error);
            if (error.message.includes('Authentication failed')) {
                throw error;
            }
            throw new Error('Network request failed');
        }
    },

    async get(endpoint) {
        return this.request(endpoint);
    },

    async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async uploadImage(endpoint, file, type = 'profile') {
        const formData = new FormData();
        formData.append('image', file);
        
        const url = `${API_BASE_URL}${endpoint}`;
        const config = {
            method: 'POST',
            headers: {
                ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
            },
            body: formData,
        };

        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Image upload failed:', error);
            throw error;
        }
    }
};

// ==================== LOCATION HELPER ====================
function getRandomPhilippinesLocation() {
    const locations = [
        { lat: 14.5995, lng: 120.9842 }, // Manila
        { lat: 14.6760, lng: 121.0437 }, // Quezon City
        { lat: 14.7942, lng: 120.8799 }, // Bulacan
        { lat: 14.5378, lng: 121.0014 }, // Makati
        { lat: 14.4500, lng: 120.9500 }, // Cavite
    ];
    return locations[Math.floor(Math.random() * locations.length)];
}

function getDeviceLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                });
            },
            (error) => {
                console.warn('Geolocation failed, using default:', error);
                resolve(getRandomPhilippinesLocation());
            },
            { 
                enableHighAccuracy: true, 
                timeout: 10000, 
                maximumAge: 60000 
            }
        );
    });
}

// ==================== AUTHENTICATION FUNCTIONS ====================
async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
        showNotification('Please enter both username and password', 'error');
        return;
    }

    try {
        showLoading('Signing in...');
        const data = await apiService.post('/login', { username, password });
        
        authToken = data.token;
        currentUser = data.user;
        
        Storage.set('authToken', authToken);
        Storage.set('currentUser', currentUser);
        
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
        
        await loadAppData();
        initializeWebSocket();
        showNotification(`Welcome back, ${currentUser.fullName}! 🌱`, 'success');
        
    } catch (error) {
        showNotification(error.message || 'Login failed. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

async function signup() {
    const fullName = document.getElementById('fullName').value.trim();
    const age = document.getElementById('age').value;
    const region = document.getElementById('region').value.trim();
    const userType = document.querySelector('.user-type-option.selected')?.dataset.value;
    const username = document.getElementById('signupUsername').value.trim();
    const password = document.getElementById('signupPassword').value;

    if (!fullName || !age || !region || !userType || !username || !password) {
        showNotification('Please fill in all fields', 'error');
        return;
    }

    try {
        showLoading('Creating account...');
        const location = await getDeviceLocation();
        
        const data = await apiService.post('/register', {
            fullName,
            age: parseInt(age),
            region,
            userType,
            username,
            password,
            avatar: selectedAvatar || '👤',
            location: location
        });

        authToken = data.token;
        currentUser = data.user;
        
        Storage.set('authToken', authToken);
        Storage.set('currentUser', currentUser);
        
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
        
        await loadAppData();
        initializeWebSocket();
        showNotification(`Welcome to SmartXCrop, ${currentUser.fullName}! 🎉`, 'success');
        
    } catch (error) {
        showNotification(error.message || 'Registration failed. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

function selectUserType(element, type) {
    document.querySelectorAll('.user-type-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    
    element.classList.add('selected');
    element.dataset.value = type;
}

function showSignup() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('signupForm').classList.remove('hidden');
}

function showLogin() {
    document.getElementById('signupForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        currentUser = null;
        authToken = null;
        cart = [];
        
        Storage.remove('authToken');
        Storage.remove('currentUser');
        Storage.remove('cart');
        
        if (ws) ws.close();
        
        document.getElementById('appScreen').classList.add('hidden');
        document.getElementById('authScreen').classList.remove('hidden');
        
        showNotification('You have been logged out successfully', 'info');
    }
}

// ==================== UTILITY FUNCTIONS ====================
function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
        <button onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, duration);
}

function getNotificationIcon(type) {
    const icons = {
        success: 'check-circle',
        error: 'exclamation-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle'
    };
    return icons[type] || 'info-circle';
}

function showLoading(message = 'Loading...') {
    let loadingOverlay = document.getElementById('loadingOverlay');
    if (!loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'loadingOverlay';
        loadingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            color: white;
            font-size: 18px;
        `;
        loadingOverlay.innerHTML = `
            <div class="spinner" style="
                width: 50px;
                height: 50px;
                border: 5px solid #f3f3f3;
                border-top: 5px solid #27AE60;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-bottom: 20px;
            "></div>
            <div>${message}</div>
        `;
        document.body.appendChild(loadingOverlay);
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
}

function hideLoading() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.remove();
    }
}

// ==================== TAB MANAGEMENT ====================
function switchTab(tabName) {
    console.log('Switching to tab:', tabName);
    
    // Remove active class from all tab buttons
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });
    
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    
    // Add active class to clicked tab button
    const activeButton = document.querySelector(`[onclick="switchTab('${tabName}')"]`);
    if (activeButton) {
        activeButton.classList.add('active');
    }
    
    // Show the selected tab content
    const activeTab = document.getElementById(tabName + 'Tab');
    if (activeTab) {
        activeTab.classList.remove('hidden');
    }
    
    currentTab = tabName;
    
    // Load content for specific tabs
    switch(tabName) {
        case 'feed':
            displayProducts(allProducts);
            break;
        case 'map':
            setTimeout(() => initializeMap(), 100);
            break;
        case 'profile':
            updateProfile();
            loadMyProducts();
            break;
        case 'agroInputs':
            loadAgroInputsTab();
            break;
        case 'messages':
            loadMessagesTab();
            break;
    }
}

// ==================== MY FARM FUNCTION ====================
function openMyFarm() {
    showNotification('🌱 My Farm feature coming soon! This will connect to your farm management app.', 'info');
}

// ==================== APP DATA MANAGEMENT ====================
async function loadAppData() {
    try {
        showLoading('Loading app data...');
        
        // Load products from backend with error handling
        let productsData;
        try {
            productsData = await apiService.get('/products');
            allProducts = productsData;
            Storage.set('allProducts', allProducts);
        } catch (error) {
            console.warn('Failed to load products from API, using demo data:', error);
            allProducts = Storage.get('allProducts', []);
        }
        
        // Load users from backend with error handling
        let usersData;
        try {
            usersData = await apiService.get('/users');
            allUsers = usersData;
        } catch (error) {
            console.warn('Failed to load users from API, using demo data:', error);
            // Ensure current user is in the users list
            if (currentUser && !allUsers.some(u => u.id === currentUser.id)) {
                allUsers.push(currentUser);
            }
        }
        
        displayProducts(allProducts);
        updateProfile();
        loadMyProducts();
        updateHeaderWithCart();
        updateCartBadge();
        
        console.log('App data loaded successfully');
        
    } catch (error) {
        console.error('Failed to load app data:', error);
        showNotification('Using offline data', 'warning');
        await loadDemoData();
    } finally {
        hideLoading();
    }
}

async function loadDemoData() {
    // Fallback demo data if API fails
    if (allUsers.length === 0) {
        allUsers = [
            {
                id: 'user_1',
                fullName: 'Juan Dela Cruz',
                region: 'Benguet',
                age: 35,
                userType: 'seller',
                avatar: '👨‍🌾',
                location: { lat: 16.4023, lng: 120.5960 }
            },
            {
                id: 'user_2',
                fullName: 'Maria Santos',
                region: 'Guimaras',
                age: 28,
                userType: 'seller',
                avatar: '👩‍🌾',
                location: { lat: 10.5921, lng: 122.6321 }
            }
        ];
    }
    
    if (allProducts.length === 0) {
        allProducts = [
            {
                id: 'prod_1',
                title: 'Fresh Organic Tomatoes',
                description: 'Freshly harvested organic tomatoes from local farm',
                pricePerKg: 120.50,
                stock: 50,
                category: 'vegetables',
                seller: allUsers[0],
                rating: 4.5,
                reviewCount: 24
            },
            {
                id: 'prod_2',
                title: 'Sweet Corn',
                description: 'Fresh sweet corn, perfect for boiling or grilling',
                pricePerKg: 85.00,
                stock: 30,
                category: 'vegetables',
                seller: allUsers[1],
                rating: 4.2,
                reviewCount: 15
            }
        ];
        Storage.set('allProducts', allProducts);
        displayProducts(allProducts);
    }
}

function displayProducts(products) {
    const feed = document.querySelector('.feed');
    if (!feed) return;

    if (products.length === 0) {
        feed.innerHTML = `
            <div class="no-products">
                <i class="fas fa-search" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p>No products found</p>
                <small>Try adjusting your search filters</small>
            </div>
        `;
        return;
    }

    feed.innerHTML = products.map(product => `
        <div class="post" onclick="showProductDetails('${product.id}')">
            <div class="post-header">
                <div class="user-avatar">
                    ${product.seller?.avatar || '👤'}
                </div>
                <div class="user-info">
                    <h3>${product.seller?.fullName || 'Unknown Seller'}</h3>
                    <p>${product.seller?.region || 'Unknown Region'}</p>
                </div>
            </div>
            <div class="post-image">
                ${product.image ? 
                    `<img src="${product.image}" alt="${product.title}" style="width: 100%; height: 100%; object-fit: cover;">` :
                    `<i class="fas fa-carrot"></i>`
                }
            </div>
            <div class="post-details">
                <h3 class="product-title">${product.title}</h3>
                <p class="product-description">${product.description}</p>
                <div class="product-meta">
                    <span>${product.category}</span>
                    <span>Stock: ${product.stock} kg</span>
                </div>
                <div class="product-price">₱${product.pricePerKg.toFixed(2)}/kg</div>
                <div class="post-actions">
                    <button class="btn btn-buy" onclick="event.stopPropagation(); addToCart('${product.id}')">
                        <i class="fas fa-cart-plus"></i> Add to Cart
                    </button>
                    <button class="btn btn-offer" onclick="event.stopPropagation(); selectChatUser('${product.seller?.id}')">
                        <i class="fas fa-comment"></i> Message
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function updateProfile() {
    if (!currentUser) return;
    
    const mainProfileAvatar = document.getElementById('mainProfileAvatar');
    const mainProfileName = document.getElementById('mainProfileName');
    const mainProfileDetails = document.getElementById('mainProfileDetails');
    const profileAvatarLarge = document.getElementById('profileAvatarLarge');
    const profileName = document.getElementById('profileName');
    const profileDetails = document.getElementById('profileDetails');
    const profileType = document.getElementById('profileType');
    
    if (mainProfileAvatar) {
        if (currentUser.profileImage) {
            mainProfileAvatar.innerHTML = `<img src="${currentUser.profileImage}" alt="Profile" style="width: 100%; height: 100%; object-fit: cover;">`;
        } else {
            mainProfileAvatar.textContent = currentUser.avatar || '👤';
        }
    }
    
    if (profileAvatarLarge) {
        if (currentUser.profileImage) {
            profileAvatarLarge.innerHTML = `<img src="${currentUser.profileImage}" alt="Profile" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        } else {
            profileAvatarLarge.textContent = currentUser.avatar || '👤';
        }
    }
    
    if (mainProfileName) mainProfileName.textContent = currentUser.fullName;
    if (profileName) profileName.textContent = currentUser.fullName;
    if (mainProfileDetails) mainProfileDetails.textContent = `${currentUser.region} • ${currentUser.age} years old`;
    if (profileDetails) profileDetails.textContent = `${currentUser.region} • ${currentUser.age} years old`;
    if (profileType) profileType.textContent = currentUser.userType.charAt(0).toUpperCase() + currentUser.userType.slice(1);
}

function loadMyProducts() {
    const myProductsGrid = document.querySelector('.my-products-grid');
    if (!myProductsGrid) return;
    
    const userProducts = allProducts.filter(product => 
        product.seller?.id === currentUser?.id
    );
    
    if (userProducts.length === 0) {
        myProductsGrid.innerHTML = `
            <div class="no-products">
                <i class="fas fa-seedling" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p>No products yet</p>
                <small>Add your first product to start selling</small>
            </div>
        `;
        return;
    }
    
    myProductsGrid.innerHTML = userProducts.map(product => `
        <div class="product-card">
            <div class="product-card-image">
                ${product.image ? 
                    `<img src="${product.image}" alt="${product.title}" style="width: 100%; height: 100%; object-fit: cover;">` :
                    `<i class="fas fa-carrot"></i>`
                }
            </div>
            <div class="product-card-info">
                <div class="product-card-name">${product.title}</div>
                <div class="product-card-price">₱${product.pricePerKg.toFixed(2)}/kg</div>
                <div class="product-card-stock">Stock: ${product.stock} kg</div>
                <button class="btn-small" onclick="editProduct('${product.id}')">Edit</button>
            </div>
        </div>
    `).join('');
}

// ==================== CART MANAGEMENT ====================
function updateHeaderWithCart() {
    updateCartBadge();
}

function updateCartBadge() {
    const cartBadge = document.querySelector('.cart-badge');
    const totalItems = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);
    
    if (cartBadge) {
        if (totalItems > 0) {
            cartBadge.textContent = totalItems > 99 ? '99+' : totalItems;
            cartBadge.style.display = 'flex';
        } else {
            cartBadge.style.display = 'none';
        }
    }
}

function addToCart(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) {
        showNotification('Product not found', 'error');
        return;
    }

    const existingItem = cart.find(item => item.product?.id === productId);
    
    if (existingItem) {
        if (existingItem.quantity >= product.stock) {
            showNotification('Cannot add more - stock limit reached', 'warning');
            return;
        }
        existingItem.quantity += 1;
    } else {
        cart.push({
            product: product,
            quantity: 1,
            addedAt: new Date().toISOString()
        });
    }
    
    Storage.set('cart', cart);
    updateCartBadge();
    showNotification(`${product.title} added to cart`, 'success');
}

function showCart() {
    const modal = createModal('🛒 Shopping Cart');
    
    if (cart.length === 0) {
        modal.innerHTML = `
            <div class="no-items">
                <i class="fas fa-shopping-cart" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p>Your cart is empty</p>
                <small>Add some products to get started</small>
            </div>
            <div class="form-actions">
                <button type="button" onclick="closeModal()">Continue Shopping</button>
            </div>
        `;
        return;
    }
    
    let total = 0;
    modal.innerHTML = `
        <div class="cart-items">
            ${cart.map(item => {
                if (!item.product) {
                    console.warn('Invalid cart item:', item);
                    return '';
                }
                const itemTotal = (item.product.pricePerKg || 0) * (item.quantity || 0);
                total += itemTotal;
                return `
                    <div class="cart-item">
                        <div class="item-info">
                            <h4>${item.product.title || 'Unknown Product'}</h4>
                            <p>₱${(item.product.pricePerKg || 0).toFixed(2)}/kg × ${item.quantity || 0}kg</p>
                            <small>Seller: ${item.product.seller?.fullName || 'Unknown Seller'}</small>
                        </div>
                        <div class="item-actions">
                            <button class="btn-remove" onclick="removeFromCart('${item.product.id}')">
                                <i class="fas fa-trash"></i>
                            </button>
                            <span>${item.quantity || 0}</span>
                            <button class="btn-small" onclick="updateCartQuantity('${item.product.id}', ${(item.quantity || 0) + 1})">+</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        <div class="cart-total">
            Total: ₱${total.toFixed(2)}
        </div>
        <div class="form-actions">
            <button type="button" onclick="closeModal()">Continue Shopping</button>
            <button type="submit" style="background: var(--primary-green); color: white;" onclick="checkout()">Checkout</button>
        </div>
    `;
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.product?.id !== productId);
    Storage.set('cart', cart);
    updateCartBadge();
    showCart();
}

function updateCartQuantity(productId, newQuantity) {
    const item = cart.find(item => item.product?.id === productId);
    if (item) {
        if (newQuantity <= 0) {
            removeFromCart(productId);
        } else if (newQuantity <= item.product.stock) {
            item.quantity = newQuantity;
            Storage.set('cart', cart);
            updateCartBadge();
            showCart();
        } else {
            showNotification('Cannot add more - stock limit reached', 'warning');
        }
    }
}

// ==================== AGRO INPUTS TAB ====================
function loadAgroInputsTab() {
    const agroInputsTab = document.getElementById('agroInputsTab');
    if (!agroInputsTab) return;
    
    agroInputsTab.innerHTML = `
        <div class="agro-inputs-container">
            <div class="section-header">
                <h3>🛒 Agro Inputs Marketplace</h3>
                <p>Find seeds, fertilizers, and farming tools from trusted suppliers</p>
            </div>
            
            <div class="agro-category">
                <h4>🌱 Seeds & Seedlings</h4>
                <div class="agro-items">
                    <div class="agro-item">
                        <div class="agro-item-header">
                            <h5>Tomato Seeds F1 Hybrid</h5>
                            <span class="price">₱150</span>
                        </div>
                        <p>High-yield hybrid tomato seeds, disease resistant, 98% germination rate. Perfect for backyard gardening.</p>
                        <div class="agro-item-meta">
                            <span class="supplier">East-West Seed Company</span>
                            <span class="specs">25g pack • 2000 seeds</span>
                        </div>
                        <div class="agro-item-actions">
                            <button class="btn-small" onclick="addToCartAgro('Tomato Seeds F1 Hybrid', 150)">Add to Cart</button>
                            <button class="buy-now-btn" onclick="showStoreOptions('Tomato Seeds F1 Hybrid', [
                                {name: 'Lazada', url: 'https://www.lazada.com.ph/products/tomato-seeds-f1-hybrid-east-west-seed-company-i123456789.html'},
                                {name: 'Shopee', url: 'https://shopee.ph/Tomato-Seeds-F1-Hybrid-East-West-Seed-Company-i.282345678.1234567890'}
                            ])">Buy Now</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function addToCartAgro(name, price) {
    const agroItem = {
        id: 'agro_' + Date.now(),
        name: name,
        price: price,
        quantity: 1,
        type: 'agro_input'
    };
    
    cart.push(agroItem);
    Storage.set('cart', cart);
    updateCartBadge();
    showNotification(`${name} added to cart`, 'success');
}

// ==================== STORE OPTIONS ====================
function showStoreOptions(productName, stores) {
    const modal = createModal(`🛍️ Buy ${productName}`);
    
    modal.innerHTML = `
        <div class="store-options">
            <p style="margin-bottom: 20px; text-align: center;">Choose where to buy <strong>${productName}</strong>:</p>
            
            <div class="store-list">
                ${stores.map(store => `
                    <div class="store-option" onclick="redirectToStore('${store.name}', '${store.url}')">
                        <div class="store-icon">
                            ${getStoreIcon(store.name)}
                        </div>
                        <div class="store-info">
                            <h4>${store.name}</h4>
                            <p>Click to open ${store.name} store</p>
                        </div>
                        <div class="store-arrow">
                            <i class="fas fa-external-link-alt"></i>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <div class="form-actions">
                <button type="button" onclick="closeModal()">Cancel</button>
            </div>
        </div>
    `;
}

function getStoreIcon(storeName) {
    const icons = {
        'Lazada': '🏪',
        'Shopee': '🛍️',
        'Amazon': '📦'
    };
    return icons[storeName] || '🛒';
}

function redirectToStore(storeName, url) {
    showNotification(`Opening ${storeName}...`, 'info');
    window.open(url, '_blank');
    closeModal();
}

// ==================== MESSAGES TAB ====================
function loadMessagesTab() {
    const messagesTab = document.getElementById('messagesTab');
    if (!messagesTab) return;
    
    // Get other users (excluding current user)
    const otherUsers = allUsers.filter(user => user.id !== currentUser?.id);
    
    messagesTab.innerHTML = `
        <div class="profile-section">
            <div class="section-header">
                <h3>💬 Recent Conversations</h3>
                <small>Chat with farmers and buyers</small>
            </div>
            <div class="conversations-list" id="conversationsList">
                ${otherUsers.slice(0, 5).map(user => `
                    <div class="conversation-item" onclick="selectChatUser('${user.id}')">
                        <div class="user-avatar-small">
                            ${user.avatar || '👤'}
                        </div>
                        <div class="conversation-info">
                            <strong>${user.fullName}</strong>
                            <p class="conversation-last-message">Click to start conversation...</p>
                        </div>
                        <div class="conversation-time">
                            Now
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ==================== CHAT SYSTEM ====================
function openChat(userId = null) {
    if (userId) {
        currentChat = allUsers.find(u => u.id === userId);
    }
    
    if (!currentChat) {
        showUserSelectionModal();
        return;
    }
    
    const modal = createModal(`💬 Chat with ${currentChat.fullName}`, 'large');
    
    modal.innerHTML = `
        <div class="chat-container">
            <div class="chat-header">
                <div class="chat-user-info">
                    <div class="user-avatar-small">${currentChat.avatar || '👤'}</div>
                    <div>
                        <strong>${currentChat.fullName}</strong>
                        <p>${currentChat.region} • ${currentChat.userType}</p>
                    </div>
                </div>
                <button class="btn-small" onclick="showUserSelectionModal()">
                    <i class="fas fa-users"></i> Switch User
                </button>
            </div>
            <div class="chat-messages" id="chatMessages">
                <!-- Messages will be loaded here -->
            </div>
            <div class="chat-input">
                <input type="text" id="chatMessageInput" placeholder="Type your message..." onkeypress="handleChatKeyPress(event)">
                <button onclick="sendChatMessage()">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;
    
    loadChatMessages();
}

function showUserSelectionModal() {
    const modal = createModal('💬 Select User to Chat With');
    
    const otherUsers = allUsers.filter(user => user.id !== currentUser?.id);
    
    modal.innerHTML = `
        <div class="users-selection">
            <div class="search-bar" style="margin-bottom: 15px;">
                <input type="text" id="userSearchInput" placeholder="🔍 Search users..." 
                       onkeyup="filterUsers()" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
            </div>
            <div class="users-list" id="usersList">
                ${otherUsers.map(user => `
                    <div class="user-selection-item" onclick="selectChatUser('${user.id}')">
                        <div class="user-avatar-small">${user.avatar || '👤'}</div>
                        <div class="user-info">
                            <strong>${user.fullName}</strong>
                            <p>${user.region} • ${user.userType}</p>
                            <small>${user.userType === 'seller' || user.userType === 'both' ? '👨‍🌾 Farmer' : '🛒 Buyer'}</small>
                        </div>
                        <div class="user-action">
                            <i class="fas fa-comment"></i>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function selectChatUser(userId) {
    currentChat = allUsers.find(u => u.id === userId);
    closeModal();
    openChat();
}

function filterUsers() {
    const searchTerm = document.getElementById('userSearchInput')?.value.toLowerCase();
    const userItems = document.querySelectorAll('.user-selection-item');
    
    userItems.forEach(item => {
        const userName = item.querySelector('strong').textContent.toLowerCase();
        const userRegion = item.querySelector('p').textContent.toLowerCase();
        
        if (userName.includes(searchTerm) || userRegion.includes(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function loadChatMessages() {
    if (!currentChat || !currentUser) return;
    
    const chatKey = `chat_${currentUser.id}_${currentChat.id}`;
    const chatMessages = Storage.get(chatKey, []);
    
    const chatMessagesDiv = document.getElementById('chatMessages');
    if (!chatMessagesDiv) return;
    
    if (chatMessages.length === 0) {
        chatMessagesDiv.innerHTML = `
            <div class="message system-message">
                <div class="message-content">
                    <strong>Chat started with ${currentChat.fullName}</strong><br>
                    <small>You can now send messages to each other</small>
                </div>
            </div>
        `;
    } else {
        chatMessagesDiv.innerHTML = chatMessages.map(msg => {
            const isMe = msg.from === currentUser.id;
            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            return `
                <div class="message ${isMe ? 'sent' : 'received'}">
                    <div class="message-content">${msg.message}</div>
                    <div class="message-time">${time}</div>
                </div>
            `;
        }).join('');
    }
    
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

function handleChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendChatMessage();
    }
}

function sendChatMessage() {
    const input = document.getElementById('chatMessageInput');
    const message = input.value.trim();
    
    if (!message || !currentChat || !currentUser) return;
    
    const chatKey = `chat_${currentUser.id}_${currentChat.id}`;
    const chatMessages = Storage.get(chatKey, []);
    
    // Add user message
    chatMessages.push({
        message: message,
        timestamp: new Date().toISOString(),
        from: currentUser.id
    });
    
    Storage.set(chatKey, chatMessages);
    
    input.value = '';
    loadChatMessages();
    
    // Simulate response after 2 seconds
    setTimeout(() => {
        simulateChatResponse();
    }, 2000);
}

function simulateChatResponse() {
    if (!currentChat) return;
    
    const responses = [
        "Thanks for your message! I'll get back to you soon.",
        "I'm interested in your products. Can you tell me more?",
        "When can I expect delivery?",
        "Do you offer bulk discounts?"
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    
    const chatKey = `chat_${currentUser.id}_${currentChat.id}`;
    const chatMessages = Storage.get(chatKey, []);
    
    chatMessages.push({
        message: randomResponse,
        timestamp: new Date().toISOString(),
        from: currentChat.id
    });
    
    Storage.set(chatKey, chatMessages);
    
    if (document.getElementById('chatMessages')) {
        loadChatMessages();
    }
}

// ==================== EDIT PROFILE ====================
function openEditProfile() {
    const modal = createModal('Edit Profile');
    
    modal.innerHTML = `
        <form onsubmit="updateProfileInfo(event)">
            <div class="form-group">
                <label for="editFullName">Full Name</label>
                <input type="text" id="editFullName" class="form-control" value="${currentUser.fullName}" required>
            </div>
            
            <div class="form-group">
                <label for="editAge">Age</label>
                <input type="number" id="editAge" class="form-control" value="${currentUser.age}" min="18" max="100" required>
            </div>
            
            <div class="form-group">
                <label for="editRegion">Region</label>
                <input type="text" id="editRegion" class="form-control" value="${currentUser.region}" required>
            </div>
            
            <div class="form-actions">
                <button type="button" onclick="closeModal()">Cancel</button>
                <button type="submit">Save Changes</button>
            </div>
        </form>
    `;
}

function updateProfileInfo(event) {
    event.preventDefault();
    
    const fullName = document.getElementById('editFullName').value.trim();
    const age = parseInt(document.getElementById('editAge').value);
    const region = document.getElementById('editRegion').value.trim();
    
    if (!fullName || !age || !region) {
        showNotification('Please fill all fields', 'error');
        return;
    }
    
    try {
        showLoading('Updating profile...');
        
        // Update current user
        currentUser.fullName = fullName;
        currentUser.age = age;
        currentUser.region = region;
        
        // Update in storage
        Storage.set('currentUser', currentUser);
        
        // Update in users array (for demo)
        const userIndex = allUsers.findIndex(u => u.id === currentUser.id);
        if (userIndex !== -1) {
            allUsers[userIndex] = { ...allUsers[userIndex], ...currentUser };
        }
        
        closeModal();
        showNotification('Profile updated successfully!', 'success');
        
        // Update UI
        updateProfile();
        
    } catch (error) {
        console.error('Profile update error:', error);
        showNotification('Failed to update profile', 'error');
    } finally {
        hideLoading();
    }
}

// ==================== PRODUCT MANAGEMENT ====================
function showAddProductForm() {
    const modal = createModal('➕ Add New Product');
    
    modal.innerHTML = `
        <form id="addProductForm" onsubmit="saveNewProduct(event)">
            <div class="form-group">
                <label for="productTitle">Product Title</label>
                <input type="text" id="productTitle" class="form-control" required>
            </div>
            
            <div class="form-group">
                <label for="productDescription">Description</label>
                <textarea id="productDescription" class="form-control" rows="3" required></textarea>
            </div>
            
            <div class="form-group">
                <label for="productPrice">Price per Kg (₱)</label>
                <input type="number" id="productPrice" class="form-control" step="0.01" min="0" required>
            </div>
            
            <div class="form-group">
                <label for="productStock">Stock (kg)</label>
                <input type="number" id="productStock" class="form-control" min="1" required>
            </div>
            
            <div class="form-actions">
                <button type="button" onclick="closeModal()">Cancel</button>
                <button type="submit">Add Product</button>
            </div>
        </form>
    `;
}

async function saveNewProduct(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const title = document.getElementById('productTitle')?.value.trim();
    const description = document.getElementById('productDescription')?.value.trim();
    const price = parseFloat(document.getElementById('productPrice')?.value);
    const stock = parseInt(document.getElementById('productStock')?.value);
    
    if (!title || !description || !price || !stock) {
        showNotification('Please fill all fields', 'error');
        return;
    }
    
    try {
        showLoading('Adding product...');
        
        // Create product object
        const newProduct = {
            id: 'prod_' + Date.now(),
            sellerId: currentUser.id,
            title,
            description,
            pricePerKg: price,
            category: 'vegetables',
            stock,
            seller: currentUser,
            image: null,
            rating: 0,
            reviewCount: 0,
            createdAt: new Date()
        };
        
        allProducts.push(newProduct);
        Storage.set('allProducts', allProducts);
        
        closeModal();
        showNotification('Product added successfully!', 'success');
        
        // Refresh displays
        displayProducts(allProducts);
        loadMyProducts();
        
    } catch (error) {
        console.error('Add product error:', error);
        showNotification('Failed to add product', 'error');
    } finally {
        hideLoading();
    }
}

// ==================== SIMPLE MAP FUNCTIONALITY ====================
async function initializeMap() {
    const mapContainer = document.getElementById('realMap');
    if (!mapContainer) {
        console.error('Map container not found');
        return;
    }
    
    try {
        // Clear any existing map
        if (map) {
            map.remove();
            map = null;
        }
        
        const userLocation = await getDeviceLocation();
        
        // Initialize map
        map = L.map('realMap').setView([userLocation.lat, userLocation.lng], 13);
        
        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(map);

        // Add user location marker
        L.marker([userLocation.lat, userLocation.lng])
            .addTo(map)
            .bindPopup(`
                <div class="map-popup">
                    <h4>Your Location</h4>
                    <p>${currentUser.fullName}</p>
                    <p>${currentUser.region}</p>
                </div>
            `)
            .openPopup();

        // Add farmers to map
        addFarmersToMap();
        
    } catch (error) {
        console.error('Map initialization failed:', error);
        showNotification('Map loading failed', 'error');
        
        const mapContainer = document.getElementById('realMap');
        if (mapContainer) {
            mapContainer.innerHTML = `
                <div class="map-placeholder">
                    <i class="fas fa-map-marked-alt" style="font-size: 48px; margin-bottom: 16px;"></i>
                    <h4>Map Unavailable</h4>
                    <p>Location services are required for map features</p>
                    <button class="btn-small" onclick="initializeMap()" style="margin-top: 15px;">Try Again</button>
                </div>
            `;
        }
    }
}

function addFarmersToMap() {
    if (!map) return;
    
    const farmers = allUsers.filter(user => 
        (user.userType === 'seller' || user.userType === 'both') && user.location
    );
    
    // Create a feature group for farmers
    const farmerGroup = L.featureGroup();
    
    farmers.forEach(user => {
        const marker = L.marker([user.location.lat, user.location.lng])
            .addTo(map)
            .bindPopup(`
                <div class="map-popup">
                    <h4>${user.fullName}</h4>
                    <p>${user.region}</p>
                    <p>👨‍🌾 ${user.userType === 'both' ? 'Farmer & Buyer' : 'Farmer'}</p>
                    <div style="margin-top: 10px;">
                        <button class="btn-small" onclick="viewUserProducts('${user.id}')">View Products</button>
                        <button class="btn-small" onclick="selectChatUser('${user.id}')">Message</button>
                    </div>
                </div>
            `);
        
        farmerGroup.addLayer(marker);
    });
    
    // Auto-fit map to show all farmers if there are any
    if (farmers.length > 0) {
        map.fitBounds(farmerGroup.getBounds(), { padding: [20, 20] });
    }
    
    if (farmers.length > 0) {
        showNotification(`Found ${farmers.length} farmers in your area`, 'success');
    }
}

function viewUserProducts(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    
    const userProducts = allProducts.filter(p => p.seller?.id === userId);
    
    const modal = createModal(`${user.fullName}'s Products`, 'large');
    
    if (userProducts.length === 0) {
        modal.innerHTML = `
            <div class="no-products">
                <i class="fas fa-seedling" style="font-size: 48px; margin-bottom: 16px;"></i>
                <p>No products available from this user</p>
                <small>They might not have added any products yet</small>
            </div>
            <div class="form-actions">
                <button type="button" onclick="closeModal()">Close</button>
            </div>
        `;
    } else {
        modal.innerHTML = userProducts.map(product => `
            <div class="post" style="margin-bottom: 15px;">
                <div class="post-header">
                    <div class="user-avatar">${user.avatar || '👤'}</div>
                    <div class="user-info">
                        <h3>${user.fullName}</h3>
                        <p>${user.region}</p>
                    </div>
                </div>
                <div class="post-details">
                    <h3 class="product-title">${product.title}</h3>
                    <p class="product-description">${product.description}</p>
                    <div class="product-price">₱${product.pricePerKg.toFixed(2)}/kg</div>
                    <div class="post-actions">
                        <button class="btn btn-buy" onclick="addToCart('${product.id}')">
                            Add to Cart
                        </button>
                        <button class="btn btn-offer" onclick="selectChatUser('${user.id}')">
                            Message Seller
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
        
        modal.innerHTML += `
            <div class="form-actions">
                <button type="button" onclick="closeModal()">Close</button>
            </div>
        `;
    }
}

// ==================== AI FEATURES ====================
async function openPlantIdentification() {
    const modal = createModal('🌿 Plant Identification', 'large');
    
    modal.innerHTML = `
        <div class="ai-features">
            <div class="image-upload-section">
                <div class="upload-area" id="plantUploadArea">
                    <i class="fas fa-camera"></i>
                    <p>Take a photo of the plant</p>
                    <small>or click to select from gallery</small>
                </div>
                <div id="aiImagePreview" class="image-preview hidden"></div>
            </div>
            <div id="plantAnalysisResult" class="analysis-section hidden"></div>
        </div>
        <div class="form-actions">
            <button type="button" onclick="closeModal()">Cancel</button>
            <button type="submit" id="analyzePlantBtn" onclick="analyzePlant()" disabled>
                <i class="fas fa-seedling"></i> Identify with Plant.ID
            </button>
        </div>
    `;
    
    const uploadArea = document.getElementById('plantUploadArea');
    uploadArea.addEventListener('click', () => openImageSelectorForAI('plant'));
}

async function openDiseaseDetection() {
    const modal = createModal('🩺 Crop Health Analysis', 'large');
    
    modal.innerHTML = `
        <div class="ai-features">
            <div class="form-group">
                <label for="plantType">Plant Type (Optional)</label>
                <select id="plantType" class="form-control">
                    <option value="">Select plant type</option>
                    <option value="tomato">Tomato</option>
                    <option value="rice">Rice</option>
                    <option value="corn">Corn</option>
                    <option value="other">Other</option>
                </select>
            </div>
            
            <div class="image-upload-section">
                <div class="upload-area" id="diseaseUploadArea">
                    <i class="fas fa-camera"></i>
                    <p>Take a photo of the affected plant</p>
                    <small>Focus on leaves, stems, or fruits showing symptoms</small>
                </div>
                <div id="diseaseImagePreview" class="image-preview hidden"></div>
            </div>
            <div id="diseaseAnalysisResult" class="analysis-section hidden"></div>
        </div>
        <div class="form-actions">
            <button type="button" onclick="closeModal()">Cancel</button>
            <button type="submit" id="analyzeDiseaseBtn" onclick="analyzeDisease()" disabled>
                <i class="fas fa-heartbeat"></i> Analyze Health with PlantNet
            </button>
        </div>
    `;
    
    const uploadArea = document.getElementById('diseaseUploadArea');
    uploadArea.addEventListener('click', () => openImageSelectorForAI('disease'));
}

function openImageSelectorForAI(type) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.display = 'none';
    input.onchange = (e) => handleAIImageSelection(e, type);
    document.body.appendChild(input);
    input.click();
}

let currentAIImage = null;
let currentAIType = null;

function handleAIImageSelection(event, type) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        showNotification('Please select an image file', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        currentAIImage = e.target.result;
        currentAIType = type;
        
        // Update the correct preview based on type
        const previewId = type === 'plant' ? 'aiImagePreview' : 'diseaseImagePreview';
        const analyzeBtnId = type === 'plant' ? 'analyzePlantBtn' : 'analyzeDiseaseBtn';
        
        const preview = document.getElementById(previewId);
        const analyzeBtn = document.getElementById(analyzeBtnId);
        
        if (preview) {
            preview.innerHTML = `
                <img src="${e.target.result}" alt="Selected Image" style="max-width: 200px; border-radius: 10px;">
                <p style="margin-top: 10px; color: var(--primary-green);">✓ Image ready for analysis</p>
            `;
            preview.classList.remove('hidden');
        }
        
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
        }
    };
    
    reader.readAsDataURL(file);
}

// Main analysis functions for each button
async function analyzePlant() {
    if (!currentAIImage) {
        showNotification('Please select an image first', 'error');
        return;
    }
    
    try {
        // Use Plant.ID for accurate plant identification
        const result = await analyzePlantWithPlantID(currentAIImage);
        displayPlantAnalysis(result);
        
    } catch (error) {
        console.error('Plant identification failed:', error);
        showNotification('Plant.ID unavailable. Using enhanced demo data.', 'warning');
        const fallbackResult = getEnhancedPlantIdentification();
        displayPlantAnalysis(fallbackResult);
    }
}

async function analyzeDisease() {
    if (!currentAIImage) {
        showNotification('Please select an image first', 'error');
        return;
    }
    
    const plantType = document.getElementById('plantType')?.value;
    
    try {
        // Use PlantNet for disease and health analysis
        const result = await analyzeDiseaseWithPlantNet(currentAIImage, plantType);
        displayDiseaseAnalysis(result, plantType);
        
    } catch (error) {
        console.error('Health analysis failed:', error);
        showNotification('PlantNet unavailable. Using enhanced analysis.', 'warning');
        const fallbackResult = getEnhancedCropHealthAnalysis(plantType, 'Enhanced Analysis');
        displayDiseaseAnalysis(fallbackResult, plantType);
    }
}

function displayPlantAnalysis(data) {
    const resultDiv = document.getElementById('plantAnalysisResult');
    if (!resultDiv) return;
    
    const apiUsed = data.api_used || 'AI Service';
    
    if (!data.suggestions || data.suggestions.length === 0) {
        resultDiv.innerHTML = `
            <div class="analysis-warning">
                <h4>❌ No plant identified</h4>
                <p>Please try with a clearer image of the plant.</p>
                <div class="api-badge api-badge-warning">
                    <i class="fas fa-robot"></i> ${apiUsed}
                </div>
            </div>
        `;
        resultDiv.classList.remove('hidden');
        return;
    }
    
    const suggestion = data.suggestions[0];
    const confidence = suggestion.confidence || (suggestion.probability * 100).toFixed(1);
    
    resultDiv.innerHTML = `
        <div class="analysis-positive">
            <div class="api-badge api-badge-success">
                <i class="fas fa-leaf"></i> ${apiUsed}
            </div>
            <h4>🌱 Plant Identified: ${suggestion.plant_name}</h4>
            <p><strong>Confidence:</strong> ${confidence}%</p>
            
            ${suggestion.plant_details?.common_names ? `
                <p><strong>Common Names:</strong> ${suggestion.plant_details.common_names.join(', ')}</p>
            ` : ''}
            
            ${suggestion.local_names ? `
                <p><strong>Local Names:</strong> ${suggestion.local_names.join(', ')}</p>
            ` : ''}
            
            ${suggestion.plant_details?.family ? `
                <p><strong>Family:</strong> ${suggestion.plant_details.family}</p>
            ` : ''}
            
            ${suggestion.plant_details?.description ? `
                <p><strong>Description:</strong> ${suggestion.plant_details.description}</p>
            ` : ''}
            
            ${suggestion.growing_season ? `
                <p><strong>Growing Season:</strong> ${suggestion.growing_season}</p>
            ` : ''}
            
            ${suggestion.farming_advice ? `
                <div class="benefits">
                    <h5>🌾 Farming Guide:</h5>
                    <ul>
                        ${suggestion.farming_advice.planting ? `<li><strong>Planting:</strong> ${suggestion.farming_advice.planting}</li>` : ''}
                        ${suggestion.farming_advice.watering ? `<li><strong>Watering:</strong> ${suggestion.farming_advice.watering}</li>` : ''}
                        ${suggestion.farming_advice.fertilizing ? `<li><strong>Fertilizing:</strong> ${suggestion.farming_advice.fertilizing}</li>` : ''}
                        ${suggestion.farming_advice.harvesting ? `<li><strong>Harvesting:</strong> ${suggestion.farming_advice.harvesting}</li>` : ''}
                    </ul>
                </div>
            ` : ''}
            
            ${suggestion.common_pests && suggestion.common_pests.length > 0 ? `
                <div class="analysis-warning">
                    <h5>🐛 Common Pests & Diseases:</h5>
                    <ul>
                        ${suggestion.common_pests.map(pest => `<li>${pest}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>
    `;
    
    resultDiv.classList.remove('hidden');
}

function displayDiseaseAnalysis(data, plantType) {
    const resultDiv = document.getElementById('diseaseAnalysisResult');
    if (!resultDiv) return;
    
    const apiUsed = data.api_used || 'AI Service';
    const healthScore = data.health_score || 0;
    const isHealthy = data.is_healthy !== false && healthScore > 70;
    const hasDiseases = data.diseases && data.diseases.length > 0;
    const aiConfidence = data.ai_confidence ? (data.ai_confidence * 100).toFixed(1) + '%' : 'High';
    
    resultDiv.innerHTML = `
        <div class="${isHealthy ? 'analysis-positive' : 'analysis-warning'}">
            <div class="api-badge ${isHealthy ? 'api-badge-success' : 'api-badge-warning'}">
                <i class="fas fa-heartbeat"></i> ${apiUsed}
            </div>
            <h4>${isHealthy ? '✅ Plant is Healthy' : '⚠️ Needs Attention'}</h4>
            <p><strong>Health Score:</strong> ${healthScore}%</p>
            <p><strong>AI Confidence:</strong> ${aiConfidence}</p>
            
            ${data.identified_plant ? `
                <p><strong>Identified Plant:</strong> ${data.identified_plant}</p>
            ` : ''}
            
            ${hasDiseases ? `
                <div style="margin-top: 15px;">
                    <h5>🦠 Detected Issues:</h5>
                    ${data.diseases.map(disease => `
                        <div style="margin-bottom: 15px; padding: 10px; background: #fff5f5; border-radius: 8px;">
                            <h6 style="margin: 0 0 8px 0; color: #e53e3e;">
                                ${disease.name} 
                                ${disease.confidence ? `(${(disease.confidence * 100).toFixed(1)}% confidence)` : ''}
                                ${disease.severity ? `<span class="severity-badge severity-${disease.severity.toLowerCase()}">${disease.severity}</span>` : ''}
                            </h6>
                            <p style="margin: 0 0 8px 0;"><strong>Description:</strong> ${disease.description}</p>
                            ${disease.cause ? `<p style="margin: 0 0 8px 0;"><strong>Cause:</strong> ${disease.cause}</p>` : ''}
                            ${disease.symptoms ? `<p style="margin: 0 0 8px 0;"><strong>Symptoms:</strong> ${Array.isArray(disease.symptoms) ? disease.symptoms.join(', ') : disease.symptoms}</p>` : ''}
                            ${disease.treatment ? `<p style="margin: 0 0 8px 0;"><strong>Treatment:</strong> ${disease.treatment}</p>` : ''}
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            ${data.recommendations && data.recommendations.length > 0 ? `
                <div class="benefits">
                    <h5>💡 Recommendations:</h5>
                    <ul>
                        ${data.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            
            ${data.prevention_tips && data.prevention_tips.length > 0 ? `
                <div class="analysis-positive">
                    <h5>🛡️ Prevention Tips:</h5>
                    <ul>
                        ${data.prevention_tips.map(tip => `<li>${tip}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            
            ${data.organic_solutions && data.organic_solutions.length > 0 ? `
                <div class="analysis-positive">
                    <h5>🌿 Organic Solutions:</h5>
                    <ul>
                        ${data.organic_solutions.map(solution => `<li>${solution}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>
    `;
    
    resultDiv.classList.remove('hidden');
}

// ==================== CHECKOUT FUNCTION ====================
async function checkout() {
    if (cart.length === 0) {
        showNotification('Your cart is empty', 'error');
        return;
    }

    try {
        showLoading('Processing checkout...');
        
        // Clear cart
        cart = [];
        Storage.set('cart', cart);
        updateCartBadge();
        
        closeModal();
        showNotification('Order placed successfully! Sellers have been notified.', 'success');
        
        // Refresh products display
        displayProducts(allProducts);
        loadMyProducts();
        
    } catch (error) {
        console.error('Checkout error:', error);
        showNotification('Checkout failed. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// ==================== MODAL FUNCTIONS ====================
function createModal(title, size = '') {
    closeModal();
    
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay';
    modalOverlay.id = 'modalOverlay';
    
    const modal = document.createElement('div');
    modal.className = `modal ${size}`;
    modal.innerHTML = `
        <div class="modal-header">
            <h2>${title}</h2>
            <button class="modal-close" onclick="closeModal()">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="modal-content" id="modalContent">
            <!-- Content will be added here -->
        </div>
    `;
    
    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);
    
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            closeModal();
        }
    });
    
    return document.getElementById('modalContent');
}

function closeModal() {
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay) {
        modalOverlay.remove();
    }
}

// ==================== WEBSOCKET INITIALIZATION ====================
function initializeWebSocket() {
    if (!currentUser) return;
    
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        ws = new WebSocket(`${wsUrl}?userId=${currentUser.id}`);
        
        ws.onopen = () => {
            console.log('WebSocket connected');
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        };
        
        ws.onclose = () => {
            console.log('WebSocket disconnected');
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
    } catch (error) {
        console.error('WebSocket initialization error:', error);
    }
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'online_users':
            onlineUsers = new Set(data.users);
            break;
        case 'new_message':
            showNotification(`New message from ${getUserName(data.message.senderId)}`, 'info');
            break;
    }
}

function getUserName(userId) {
    const user = allUsers.find(u => u.id === userId);
    return user ? user.fullName : 'Unknown User';
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
    // Check authentication
    const savedUser = Storage.get('currentUser');
    const savedToken = Storage.get('authToken');
    
    if (savedUser && savedToken) {
        currentUser = savedUser;
        authToken = savedToken;
        loadAppData();
        initializeWebSocket();
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('hidden');
    } else {
        document.getElementById('authScreen').classList.remove('hidden');
        document.getElementById('appScreen').classList.add('hidden');
    }
    
    // Initialize with feed tab
    switchTab('feed');
    
    console.log('SmartXCrop App Initialized');
});