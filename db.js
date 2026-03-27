const { MongoClient } = require('mongodb');

// 🔴 الرابط الجديد بعد التعديل
const uri = "mongodb+srv://BridgeSen:11223344@bridgesendatabase.qh9vmm1.mongodb.net/bridge_monitor";

// اسم قاعدة البيانات
const dbName = "bridge_monitor";

// اسم المجموعة (Collection)
const collectionName = "bridges";

let db;
let client;

async function connectToDB() {
    if (db) return db;
    
    try {
        client = new MongoClient(uri);
        await client.connect();
        db = client.db(dbName);
        console.log("✅ متصل بقاعدة البيانات MongoDB");
        return db;
    } catch (err) {
        console.error("❌ خطأ في الاتصال بقاعدة البيانات:", err);
        throw err;
    }
}

async function getBridgesCollection() {
    const database = await connectToDB();
    return database.collection(collectionName);
}

// حفظ جميع الجسور في قاعدة البيانات
async function saveBridgesToDB(bridges) {
    try {
        const collection = await getBridgesCollection();
        // حذف كل البيانات القديمة
        await collection.deleteMany({});
        // إضافة البيانات الجديدة
        if (bridges && bridges.length > 0) {
            await collection.insertMany(bridges);
        }
        console.log(`✅ تم حفظ ${bridges.length} جسر في MongoDB`);
    } catch (err) {
        console.error("❌ خطأ في حفظ البيانات:", err);
        throw err;
    }
}

// تحميل جميع الجسور من قاعدة البيانات
async function loadBridgesFromDB() {
    try {
        const collection = await getBridgesCollection();
        const bridges = await collection.find({}).toArray();
        console.log(`✅ تم تحميل ${bridges.length} جسر من MongoDB`);
        return bridges;
    } catch (err) {
        console.error("❌ خطأ في تحميل البيانات:", err);
        throw err;
    }
}

// تصدير الدوال للاستخدام في server.js
module.exports = { connectToDB, saveBridgesToDB, loadBridgesFromDB };