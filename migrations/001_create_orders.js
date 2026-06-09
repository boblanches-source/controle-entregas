exports.up = async function up(knex) {
  await knex.schema.createTable('orders', (table) => {
    table.increments('id').primary();
    table.string('customer_name', 150).notNullable();
    table.string('initial_payment_method', 30).notNullable(); // Dinheiro | Cartão | Pix
    table.boolean('has_drink').notNullable().defaultTo(false);

    table.string('final_payment_method', 30); // preenchido na entrega
    table.string('status', 20).notNullable().defaultTo('aguardando'); // aguardando | em_rota | entregue

    table.timestamp('delivered_at').nullable();
    table.timestamps(true, true); // created_at, updated_at
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
    ON orders (status, created_at)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('orders');
};
