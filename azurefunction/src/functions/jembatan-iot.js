const { app, output } = require('@azure/functions');

const cosmosOutput = output.cosmosDB({
    databaseName: 'IoTDatabase',
    containerName: 'TelemetryData',
    connection: 'CosmosDBConnectionString',
    createIfNotExists: true
});

function getWibIsoString() {
    const now = new Date();
    const wibDate = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    return wibDate.toISOString().replace('Z', '+07:00');
}

function getWibTimestampForId() {
    const now = new Date();
    const wibDate = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    return wibDate.toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .split('.')[0];
}

app.eventHub('jembatan-iot', {
    connection: 'IotHubEndpointConnectionString',
    eventHubName: 'iothub-ehub-iothubesp3-57938526-03c4f4a01c',
    consumerGroup: 'functionapp', // Saluran baca mandiri untuk Function App
    cardinality: 'many',
    extraOutputs: [cosmosOutput],
    handler: (messages, context) => {
        const dataUntukDisimpan = [];
        
        for (const message of messages) {
            context.log('Data masuk dari ESP32:', message);
            
            // Mengambil nilai asli dari MQTT ESP32
            const rawCoffeeType = message.coffee_type || "unknown";
            const rawStatusCoffee = message.status_coffee || message.status_bean || "unknown";
            const rawBatch = message.batch || "unknown";

            // Formatting ID (huruf kecil & spasi jadi strip)
            const idCoffeeType = rawCoffeeType.toString().toLowerCase().replace(/\s+/g, '-');
            const idStatusCoffee = rawStatusCoffee.toString().toLowerCase().replace(/\s+/g, '-');
            const idBatch = rawBatch.toString().toLowerCase().replace(/\s+/g, '-');
            
            const wibTimestampIso = getWibIsoString();
            const wibTimestampId = getWibTimestampForId();
            
            // Format ID CosmosDB (Contoh: robusta_green-bean_batch-1_20261019_230000_1234)
            const customId = `${idCoffeeType}_${idStatusCoffee}_${idBatch}_${wibTimestampId}_${Math.random().toString().substring(2, 6)}`;

            dataUntukDisimpan.push({
                id: customId,
                device_id: message.device_id,
                timestamp: wibTimestampIso,
                data: {
                    coffee_type: message.coffee_type,
                    status_coffee: message.status_coffee || message.status_bean,
                    batch: message.batch,
                    firmware_version: message.firmware_version || "v1.0", // Menangkap parameter versi firmware dari ESP32
                    confidence_score: message.confidence || message.confidence_score,
                    sensors: {
                        temperature: message.temperature || message.sensors?.temperature,
                        humidity: message.humidity || message.sensors?.humidity,
                        mq3: message.mq3 || message.sensors?.mq3,
                        mq6: message.mq6 || message.sensors?.mq6,
                        mq7: message.mq7 || message.sensors?.mq7,
                        mq135: message.mq135 || message.sensors?.mq135,
                        mq138: message.mq138 || message.sensors?.mq138,
                        tgs2600: message.tgs2600 || message.sensors?.tgs2600,
                        tgs2602: message.tgs2602 || message.sensors?.tgs2602,
                        tgs2611: message.tgs2611 || message.sensors?.tgs2611,
                        tgs2620: message.tgs2620 || message.sensors?.tgs2620
                    }
                }
            });
        }
        
        context.extraOutputs.set(cosmosOutput, dataUntukDisimpan);
    }
});