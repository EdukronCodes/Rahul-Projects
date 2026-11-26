@description('Azure region for the food delivery resources.')
param location string = resourceGroup().location
@description('Globally unique Container Registry and Container App name prefix (lowercase, 3-20 characters).')
@minLength(3)
@maxLength(20)
param appName string
@description('Container image to run, including registry and tag.')
param image string
@description('Azure Container Registry login server.')
param registryServer string
@secure()
param registryUsername string
@secure()
param registryPassword string
@secure()
param databasePassword string

var databaseName = 'fooddelivery'
var serverName = '${appName}-pg'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: appName
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: true }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: serverName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: 'foodadmin'
    administratorLoginPassword: databasePassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7 }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgres
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${appName}-logs'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource environment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${appName}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2023-05-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [{
        server: registryServer
        username: registryUsername
        passwordSecretRef: 'registry-password'
      }]
      secrets: [
        { name: 'registry-password', value: registryPassword }
        { name: 'db-password', value: databasePassword }
      ]
      ingress: { external: true, targetPort: 8080, transport: 'auto' }
    }
    template: {
      containers: [{
        name: 'food-delivery'
        image: image
        env: [
          {
            name: 'DATABASE_URL'
            value: 'postgresql+psycopg://foodadmin:${databasePassword}@${serverName}.postgres.database.azure.com:5432/${databaseName}?sslmode=require'
          }
          { name: 'PORT', value: '8080' }
        ]
        resources: { cpu: json('0.5'), memory: '1Gi' }
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
  dependsOn: [database, allowAzureServices]
}

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output registryName string = registry.name
