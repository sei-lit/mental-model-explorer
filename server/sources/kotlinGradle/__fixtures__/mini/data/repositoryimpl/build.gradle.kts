plugins {
    id("usapo.primitive.kmp")
}

kotlin {
    sourceSets {
        commonMain.dependencies {
            implementation(project(":domain:usecase"))
            implementation(projects.core)
            // api(projects.domain.model)
        }
    }
}
