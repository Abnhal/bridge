const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const THRESHOLD_WARNING = 1.5;
const THRESHOLD_CRITICAL = 2.0;
const OFFLINE_TIMEOUT = 10000;

app.use(express.json());
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}

let bridges = [];
const dataFile = 'data/bridges.json';

function loadBridges() {
    try {
        if (fs.existsSync(dataFile)) {
            const data = fs.readFileSync(dataFile, 'utf8');
            bridges = JSON.parse(data);
            console.log(`✅ تم تحميل ${bridges.length} جسر`);
        } else {
            bridges = [
                {
                    id: 'region_riyadh',
                    name: 'منطقة الرياض',
                    type: 'region',
                    bridges: []
                },
                {
                    id: 'region_tabuk',
                    name: 'منطقة تبوك',
                    type: 'region',
                    bridges: []
                }
            ];
            saveBridges();
            console.log('📝 تم إنشاء مناطق تجريبية');
        }
    } catch (err) {
        console.error('❌ خطأ في تحميل البيانات:', err);
        bridges = [];
    }
}

function saveBridges() {
    try {
        fs.writeFileSync(dataFile, JSON.stringify(bridges, null, 2));
    } catch (err) {
        console.error('❌ خطأ في حفظ البيانات:', err);
    }
}

loadBridges();

app.get('/api/regions', (req, res) => {
    const regions = bridges.filter(b => b.type === 'region');
    res.json(regions);
});

app.get('/api/regions/list', (req, res) => {
    const regions = bridges
        .filter(b => b.type === 'region')
        .map(r => ({
            id: r.id,
            name: r.name
        }));
    res.json(regions);
});

app.post('/api/regions', (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'اسم المنطقة مطلوب' });
    }
    const newRegion = {
        id: 'region_' + Date.now(),
        name: name,
        type: 'region',
        bridges: []
    };
    bridges.push(newRegion);
    saveBridges();
    res.json({
        message: 'تم إضافة المنطقة',
        region: newRegion
    });
});

app.post('/api/bridges', (req, res) => {
    const { name, location, regionId } = req.body;
    if (!name || !regionId) {
        return res.status(400).json({ error: 'اسم الجسر والمنطقة مطلوبان' });
    }
    const region = bridges.find(b => b.id === regionId && b.type === 'region');
    if (!region) {
        return res.status(404).json({ error: 'المنطقة غير موجودة' });
    }
    const newBridge = {
        id: 'bridge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        name: name,
        location: location || '',
        regionId: regionId,
        status: 'offline',
        lastSeen: null,
        naturalFrequency: null,
        readings: [],
        alerts: [],
        isCalibrated: false,
        calibrationCount: 0
    };
    region.bridges.push(newBridge);
    saveBridges();
    res.json({
        message: 'تم إضافة الجسر',
        bridge: newBridge
    });
});

app.get('/api/bridges/:id', (req, res) => {
    const bridgeId = req.params.id;
    for (const region of bridges) {
        if (region.type === 'region') {
            const bridge = region.bridges.find(b => b.id === bridgeId);
            if (bridge) {
                return res.json({
                    ...bridge,
                    regionName: region.name
                });
            }
        }
    }
    res.status(404).json({ error: 'الجسر غير موجود' });
});

app.post('/api/bridges/:id/recalibrate', (req, res) => {
    const bridgeId = req.params.id;
    for (const region of bridges) {
        if (region.type === 'region') {
            const bridge = region.bridges.find(b => b.id === bridgeId);
            if (bridge) {
                bridge.isCalibrated = false;
                bridge.calibrationCount = 0;
                bridge.naturalFrequency = null;
                bridge.readings = [];
                bridge.alerts = [];
                saveBridges();
                io.emit('calibration-start', bridgeId);
                return res.json({ message: 'بدء المعايرة' });
            }
        }
    }
    res.status(404).json({ error: 'الجسر غير موجود' });
});

app.delete('/api/bridges/:id', (req, res) => {
    const bridgeId = req.params.id;
    for (const region of bridges) {
        if (region.type === 'region') {
            const index = region.bridges.findIndex(b => b.id === bridgeId);
            if (index !== -1) {
                region.bridges.splice(index, 1);
                saveBridges();
                return res.json({ message: 'تم حذف الجسر' });
            }
        }
    }
    res.status(404).json({ error: 'الجسر غير موجود' });
});

app.post('/api/data/:bridgeId', (req, res) => {
    const bridgeId = req.params.bridgeId;
    const data = req.body;
    
    if (!data || typeof data.x !== 'number' || typeof data.y !== 'number' || typeof data.z !== 'number') {
        return res.status(400).json({ error: 'بيانات غير صالحة' });
    }
    
    let targetBridge = null;
    let targetRegion = null;
    
    for (const region of bridges) {
        if (region.type === 'region') {
            const bridge = region.bridges.find(b => b.id === bridgeId);
            if (bridge) {
                targetBridge = bridge;
                targetRegion = region;
                break;
            }
        }
    }
    
    if (!targetBridge) {
        return res.status(404).json({ error: 'الجسر غير موجود' });
    }
    
    targetBridge.lastSeen = Date.now();
    targetBridge.status = 'online';
    
    const timestamp = Date.now();
    const magnitude = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
    const vibration = Math.abs(magnitude - 9.81);
    
    const reading = {
        x: data.x,
        y: data.y,
        z: data.z,
        vibration: vibration,
        timestamp: timestamp,
        timeFormatted: new Date(timestamp).toLocaleTimeString('ar-SA')
    };
    
    if (!targetBridge.isCalibrated) {
        targetBridge.calibrationCount++;
        reading.calibrationProgress = Math.min(100, (targetBridge.calibrationCount / 50) * 100);
        reading.isCalibrating = true;
        
        if (targetBridge.calibrationCount >= 50) {
            let sum = 0;
            const lastReadings = targetBridge.readings.slice(-49);
            lastReadings.forEach(r => sum += r.vibration);
            sum += vibration;
            targetBridge.naturalFrequency = sum / 50;
            targetBridge.isCalibrated = true;
            reading.calibrationComplete = true;
            
            io.emit('calibration-complete', {
                bridgeId: bridgeId,
                frequency: targetBridge.naturalFrequency
            });
        }
        
        targetBridge.readings.push(reading);
        if (targetBridge.readings.length > 200) {
            targetBridge.readings.shift();
        }
        saveBridges();
        
        io.emit(`data-${bridgeId}`, {
            ...reading,
            naturalFrequency: targetBridge.naturalFrequency,
            isCalibrated: targetBridge.isCalibrated
        });
        
    } else {
        
        const increaseRatio = (vibration - targetBridge.naturalFrequency) / targetBridge.naturalFrequency;
        const riskPercent = Math.max(0, increaseRatio * 100);
        
        reading.increaseRatio = increaseRatio;
        reading.riskPercent = riskPercent;
        
        
        reading.alert = false;
        reading.severity = 'normal';
        
        if (increaseRatio >= 1.0) { 
            reading.alert = true;
            reading.severity = 'critical';
            reading.message = '🚨 خطر شديد';
            
            const alert = {
                id: Date.now(),
                message: '🚨 خطر شديد!',
                severity: 'critical',
                vibration: vibration,
                increaseRatio: increaseRatio,
                riskPercent: riskPercent,
                timeFormatted: reading.timeFormatted
            };
            
            targetBridge.alerts.unshift(alert);
            if (targetBridge.alerts.length > 20) targetBridge.alerts.pop();
            io.emit(`alert-${bridgeId}`, alert);
            
        } else if (increaseRatio >= 0.5) { 
            reading.alert = true;
            reading.severity = 'warning';
            reading.message = '⚠️ تحذير';
            
            const alert = {
                id: Date.now(),
                message: '⚠️ تحذير: اهتزاز عالي',
                severity: 'warning',
                vibration: vibration,
                increaseRatio: increaseRatio,
                riskPercent: riskPercent,
                timeFormatted: reading.timeFormatted
            };
            
            targetBridge.alerts.unshift(alert);
            if (targetBridge.alerts.length > 20) targetBridge.alerts.pop();
            io.emit(`alert-${bridgeId}`, alert);
        }
        
        targetBridge.readings.push(reading);
        if (targetBridge.readings.length > 200) {
            targetBridge.readings.shift();
        }
        saveBridges();
        
        io.emit(`data-${bridgeId}`, {
            ...reading,
            naturalFrequency: targetBridge.naturalFrequency,
            isCalibrated: targetBridge.isCalibrated
        });
    }
    
    io.emit('bridges-status', {
        bridgeId: bridgeId,
        status: 'online',
        lastSeen: targetBridge.lastSeen
    });
    
    res.json({ status: 'ok' });
});

setInterval(() => {
    const now = Date.now();
    let changed = false;
    
    for (const region of bridges) {
        if (region.type === 'region') {
            for (const bridge of region.bridges) {
                if (bridge.status === 'online' && bridge.lastSeen && (now - bridge.lastSeen > OFFLINE_TIMEOUT)) {
                    bridge.status = 'offline';
                    changed = true;
                    io.emit('bridges-status', {
                        bridgeId: bridge.id,
                        status: 'offline'
                    });
                }
            }
        }
    }
    
    if (changed) {
        saveBridges();
    }
}, 5000);

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ================================
    🌉 نظام مراقبة الجسور
    ================================
    📡 الخادم يعمل على المنفذ: ${PORT}
    🌍 المناطق: ${bridges.filter(b => b.type === 'region').length}
    ================================
    `);
});
