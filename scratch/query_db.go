package main

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/lib/pq"
)

func main() {
	dsn := "host=localhost port=5432 user=sub2api password=sub2api dbname=sub2api sslmode=disable"
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	fmt.Println("Account 13 Details:")
	rows, err := db.Query("SELECT id, name, platform, base_url, model_mapping FROM accounts WHERE id = 13")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var name, platform string
		var baseURL sql.NullString
		var modelMapping sql.NullString
		if err := rows.Scan(&id, &name, &platform, &baseURL, &modelMapping); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("ID=%d, Name=%s, Platform=%s, BaseURL=%s, ModelMapping=%s\n", id, name, platform, baseURL.String, modelMapping.String)
	}

	fmt.Println("\nAll Active Accounts in Group 2:")
	rows, err = db.Query(`
		SELECT a.id, a.name, a.platform, a.base_url 
		FROM accounts a 
		JOIN accounts_groups ag ON a.id = ag.account_id 
		WHERE ag.group_id = 2 AND a.status = 'active'
	`)
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var name, platform string
		var baseURL sql.NullString
		if err := rows.Scan(&id, &name, &platform, &baseURL); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("ID=%d, Name=%s, Platform=%s, BaseURL=%s\n", id, name, platform, baseURL.String)
	}
}
