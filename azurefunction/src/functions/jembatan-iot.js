const { app, output } = require('@azure/functions');

// Konfigurasi output ke Cosmos DB
const cosmosOutput = output.cosmosDB({
    databaseName: 'IoTDatabase',
    containerName: 'TelemetryData',
    connection: 'CosmosDBConnectionString',
    createIfNotExists: true
});

// Konfigurasi trigger masuk dari IoT Hub
app.eventHub('jembatan-iot', {
    connection: 'IotHubEndpointConnectionString',
    eventHubName: 'iothub-ehub-iothubesp3-57938526-03c4f4a01c',
    cardinality: 'many',
    extraOutputs: [cosmosOutput],
    handler: (messages, context) => {
        const dataUntukDisimpan = [];
        
        for (const message of messages) {
            context.log('Data masuk dari ESP32:', message);
            
            dataUntukDisimpan.push({
                // Membuat ID unik agar tersimpan sebagai baris baru di Cosmos DB
                id: context.invocationId + Math.random().toString().substring(2, 10),
                data: message,
                timestamp: new Date().toISOString()
            });
        }
        
        // Mengirimkan data ke Cosmos DB
        context.extraOutputs.set(cosmosOutput, dataUntukDisimpan);
    }
});