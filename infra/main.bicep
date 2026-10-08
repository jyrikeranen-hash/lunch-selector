// Lunch List: Azure Static Web App (frontend + managed Functions API) + Storage account (Table Storage).
// Deploy:  az deployment group create -g <rg> -f infra/main.bicep -p appName=<name>

@description('Short name used as a prefix for resources (lowercase letters and digits).')
@minLength(3)
@maxLength(16)
param appName string = 'lunchlist'

@description('Region for the storage account.')
param location string = resourceGroup().location

@description('Region for the Static Web App (limited set: westeurope, eastus2, centralus, westus2, eastasia).')
@allowed(['westeurope', 'eastus2', 'centralus', 'westus2', 'eastasia'])
param swaLocation string = 'westeurope'

@description('Free = no cost, invitation-based roles (max 25 invited users). Standard = custom Entra ID tenant restriction, SLA.')
@allowed(['Free', 'Standard'])
param swaSku string = 'Free'

@description('IANA time zone used to decide what "today" means for menus.')
param timeZone string = 'Europe/Helsinki'

param tags object = {
  app: 'lunch-list'
}

var suffix = uniqueString(resourceGroup().id, appName)
var storageName = take('${toLower(appName)}${suffix}', 24)

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    allowSharedKeyAccess: true // managed SWA Functions can't use managed identity, so a connection string is used
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource placesTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'places'
}

resource menuTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: 'menucache'
}

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${appName}-swa'
  location: swaLocation
  tags: tags
  sku: {
    name: swaSku
    tier: swaSku
  }
  properties: {
    // Not linked to a repo here: GitHub Actions deploys with the deployment token instead.
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

resource swaSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
    TIME_ZONE: timeZone
  }
}

output staticWebAppName string = swa.name
output url string = 'https://${swa.properties.defaultHostname}'
output storageAccountName string = storage.name
