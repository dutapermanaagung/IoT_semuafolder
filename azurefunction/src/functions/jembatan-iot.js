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
    consumerGroup: 'functionapp',
    cardinality: 'many',
    extraOutputs: [cosmosOutput],
    handler: (messages, context) => {
        const dataUntukDisimpan = [];
        
        for (const message of messages) {
            context.log('Data masuk dari ESP32:', message);
            
            const rawCoffeeType = message.coffee_type || "unknown";
            const rawStatusCoffee = message.status_coffee || message.status_bean || "unknown";
            const rawBatch = message.batch || "unknown";

            const idCoffeeType = rawCoffeeType.toString().toLowerCase().replace(/\s+/g, '-');
            const idStatusCoffee = rawStatusCoffee.toString().toLowerCase().replace(/\s+/g, '-');
            const idBatch = rawBatch.toString().toLowerCase().replace(/\s+/g, '-');
            
            const wibTimestampIso = getWibIsoString();
            const wibTimestampId = getWibTimestampForId();
            
            const customId = `${idCoffeeType}_${idStatusCoffee}_${idBatch}_${wibTimestampId}_${Math.random().toString().substring(2, 6)}`;

            dataUntukDisimpan.push({
                id: customId,
                device_id: message.device_id || "esp32s3-device-01", // Cukup di root aja
                timestamp: wibTimestampIso,
                data: {
                    coffee_type: message.coffee_type,
                    status_coffee: message.status_coffee || message.status_bean,
                    batch: message.batch,
                    firmware_version: message.firmware_version || "v1.0",
                    connected_wifi: message.connected_wifi || message.wifi_ssid || "Unknown_WiFi",
                    confidence_score: message.confidence ?? message.confidence_score ?? null,
                    sensors: {
                        temperature: message.temperature ?? message.sensors?.temperature ?? 0,
                        humidity: message.humidity ?? message.sensors?.humidity ?? 0,
                        mq3: message.mq3 ?? message.sensors?.mq3 ?? 0,
                        mq6: message.mq6 ?? message.sensors?.mq6 ?? 0,
                        mq7: message.mq7 ?? message.sensors?.mq7 ?? 0,
                        mq135: message.mq135 ?? message.sensors?.mq135 ?? 0,
                        tgs2600: message.tgs2600 ?? message.sensors?.tgs2600 ?? 0,
                        tgs2602: message.tgs2602 ?? message.sensors?.tgs2602 ?? 0,
                        tgs2611: message.tgs2611 ?? message.sensors?.tgs2611 ?? 0,
                        tgs2620: message.tgs2620 ?? message.sensors?.tgs2620 ?? 0
                    }
                }
            });
        }
        
        context.extraOutputs.set(cosmosOutput, dataUntukDisimpan);
    }
});