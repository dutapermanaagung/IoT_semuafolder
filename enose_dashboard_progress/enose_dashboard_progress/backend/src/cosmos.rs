use azure_data_cosmos::{CosmosClient, AccountReference, AccountEndpoint, RoutingStrategy};
use azure_data_cosmos::clients::ContainerClient;
use azure_data_cosmos::feed::FeedScope;
use azure_core::credentials::Secret;
use futures_util::StreamExt;
use crate::models::Sampling;

#[derive(Clone)]
pub struct CosmosRepo {
    container: ContainerClient,
}

impl CosmosRepo {
    pub async fn new(endpoint: String, key: String, database: String, container: String) -> anyhow::Result<Self> {
        let account_endpoint: AccountEndpoint = endpoint.parse()?;
        let secret_key = Secret::new(key);
        
        let account = AccountReference::with_authentication_key(account_endpoint, secret_key);
        
        let client = CosmosClient::builder()
            .build(account, RoutingStrategy::ProximityTo("Southeast Asia".into()))
            .await?;
        
        let database_client = client.database_client(database);
        let container_client = database_client.container_client(container, None).await?;
        
        Ok(Self { container: container_client })
    }

    pub async fn insert(&self, item: &Sampling) -> anyhow::Result<()> {
        self.container
            .create_item(&item.data.coffee_type, &item.id, item, None)
            .await?;
        Ok(())
    }

    pub async fn list_by_type(&self, coffee_type: &str) -> anyhow::Result<Vec<Sampling>> {
        let query = format!(
            "SELECT * FROM c WHERE c.data.coffee_type = '{}' ORDER BY c.timestamp DESC",
            coffee_type
        );
        
        let mut pager = self.container
            .query_items::<Sampling>(
                &query,
                FeedScope::partition(coffee_type.to_string()),
                None,
            )
            .await?;

        let mut output = Vec::new();
        while let Some(item_result) = pager.next().await {
            output.push(item_result?);
        }
        
        Ok(output)
    }
}